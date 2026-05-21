import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GameStatus,
  GameType,
  type Game,
  type Prisma,
} from '@prisma/client';
import {
  type GameQuestion,
  GameQuestionSchema,
  type Language,
} from '@tutor-app/shared';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { GameGenerationQueue } from './game-generation.queue';

export interface CreateGameOpts {
  lessonId: string;
  tutorId: string;
  type: GameType;
  poolSize: number;
  /** Output language for the game — Phase 11 widened from `Locale` to
   *  `Language` to accommodate tutors teaching languages outside the
   *  three UI locales (es, fr, …). */
  locale: Language;
}

export type GameWithTutorScope = Game & {
  lesson: { id: string; student: { id: string; tutorId: string } };
};

/** A student's game + its lesson context + play stats (see `listForStudent`). */
export interface StudentGameListItem {
  game: Game;
  lessonOccurredAt: Date;
  lessonTitle: string | null;
  questionCount: number;
  lastPlayedAt: Date | null;
  playsCompleted: number;
  accuracy: number | null;
}

/**
 * Tenant-scoped CRUD over games + the question pool. Mirrors the
 * LessonService pattern: every single-game loader funnels through
 * `getForTutorOrFail`, which walks Game → Lesson → Student → Tutor and
 * returns 404 (never 401) on cross-tenant.
 */
/**
 * Thrown when the tutor's monthly cap is exhausted. The controller maps it
 * to HTTP 429 with the cap/used/resetsAt body so the UI can render a
 * specific banner instead of a generic error.
 */
export class QuotaExceededException extends HttpException {
  constructor(payload: { cap: number; used: number; resetsAt: Date }) {
    super(
      {
        error: 'quota_exceeded',
        cap: payload.cap,
        used: payload.used,
        resetsAt: payload.resetsAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: GameGenerationQueue,
    private readonly quota: QuotaService,
  ) {}

  /** Tenant-scoped single-game loader. Returns null on missing OR cross-tenant. */
  async findForTutor(opts: { id: string; tutorId: string }): Promise<GameWithTutorScope | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: opts.id },
      include: {
        lesson: {
          select: {
            id: true,
            student: { select: { id: true, tutorId: true } },
          },
        },
      },
    });
    if (!game) return null;
    if (!game.lesson || game.lesson.student.tutorId !== opts.tutorId) return null;
    return game;
  }

  async getForTutorOrFail(opts: { id: string; tutorId: string }): Promise<GameWithTutorScope> {
    const game = await this.findForTutor(opts);
    if (!game) throw new NotFoundException('Game not found.');
    return game;
  }

  /**
   * Verify the lesson belongs to the tutor before any operation that
   * accepts a lessonId from the request body/URL.
   */
  private async assertLessonOwned(opts: { lessonId: string; tutorId: string }): Promise<{
    feedbackText: string | null;
  }> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: opts.lessonId, deletedAt: null, student: { tutorId: opts.tutorId } },
      select: { feedbackText: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');
    return { feedbackText: lesson.feedbackText };
  }

  /**
   * Create a game shell and enqueue the LLM generation job. Returns the
   * GENERATING row; the client polls via GET /games/:id.
   *
   * Refuses generation if:
   *   - the lesson has no feedback yet (nothing to generate from)
   *   - the tutor's monthly cap is exhausted (429 with payload)
   *
   * Quota reservation happens BEFORE the game row exists so a refused
   * request doesn't leave an orphan FAILED row. If the in-process queue's
   * circuit breaker is open the row IS created (so the tutor sees a
   * FAILED card with an actionable retry), but the slot we reserved is
   * refunded so the breaker outage doesn't burn the tutor's cap.
   */
  async createAndEnqueue(opts: CreateGameOpts): Promise<{ game: Game; breakerOpen: boolean }> {
    const lesson = await this.assertLessonOwned({
      lessonId: opts.lessonId,
      tutorId: opts.tutorId,
    });
    if (!lesson.feedbackText || lesson.feedbackText.trim().length === 0) {
      throw new BadRequestException('Cannot generate a game: lesson has no feedback yet.');
    }

    // Atomic reserve — refused if the tutor would exceed cap.
    const reservation = await this.quota.reserveGeneration(opts.tutorId);
    if (!reservation.ok) {
      throw new QuotaExceededException({
        cap: reservation.cap,
        used: reservation.used,
        resetsAt: reservation.resetsAt,
      });
    }

    const game = await this.prisma.game.create({
      data: {
        lessonId: opts.lessonId,
        type: opts.type,
        title: defaultTitle(opts.type),
        status: GameStatus.GENERATING,
        questionPool: [] as unknown as Prisma.InputJsonValue,
        poolSize: opts.poolSize,
        locale: opts.locale,
      },
    });

    const result = this.queue.enqueue(game.id, { tutorId: opts.tutorId });
    if (result.breakerOpen) {
      // Breaker tripped before we could even attempt — refund so the
      // outage doesn't cost the tutor a slot.
      await this.quota.refundGeneration(opts.tutorId);
      const refreshed = await this.prisma.game.findUnique({ where: { id: game.id } });
      return { game: refreshed ?? game, breakerOpen: true };
    }
    return { game, breakerOpen: false };
  }

  /** List all games for a lesson (tutor-scoped via the lesson check). */
  async listForLesson(opts: { lessonId: string; tutorId: string }): Promise<Game[]> {
    await this.assertLessonOwned({ lessonId: opts.lessonId, tutorId: opts.tutorId });
    return this.prisma.game.findMany({
      where: { lessonId: opts.lessonId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every game across a student's lessons, with play stats — powers the
   * tutor-facing student page's practice-games grid. Tenant scoping is
   * enforced by the `lesson.student.tutorId` predicate; the controller also
   * verifies the student belongs to the tutor (404 before this runs).
   * One follow-up `attempt.findMany` keeps it O(games), not N+1.
   */
  async listForStudent(opts: {
    studentId: string;
    tutorId: string;
  }): Promise<StudentGameListItem[]> {
    const games = await this.prisma.game.findMany({
      where: {
        deletedAt: null,
        lesson: {
          deletedAt: null,
          studentId: opts.studentId,
          student: { tutorId: opts.tutorId },
        },
      },
      include: { lesson: { select: { occurredAt: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (games.length === 0) return [];

    const attempts = await this.prisma.attempt.findMany({
      where: { gameId: { in: games.map((g) => g.id) }, finishedAt: { not: null } },
      select: { gameId: true, score: true, questionResults: true, finishedAt: true },
    });

    type Stat = { plays: number; correct: number; answered: number; last: Date | null };
    const byGame = new Map<string, Stat>();
    for (const a of attempts) {
      let s = byGame.get(a.gameId);
      if (!s) {
        s = { plays: 0, correct: 0, answered: 0, last: null };
        byGame.set(a.gameId, s);
      }
      s.plays += 1;
      s.correct += a.score;
      s.answered += countAnswered(a.questionResults);
      if (a.finishedAt && (s.last === null || a.finishedAt > s.last)) s.last = a.finishedAt;
    }

    return games.map((g) => {
      const s = byGame.get(g.id);
      return {
        game: g,
        lessonOccurredAt: g.lesson.occurredAt,
        lessonTitle: g.lesson.title,
        questionCount: parsePool(g.questionPool).length,
        lastPlayedAt: s?.last ?? null,
        playsCompleted: s?.plays ?? 0,
        accuracy: s && s.answered > 0 ? s.correct / s.answered : null,
      };
    });
  }

  async editQuestions(opts: {
    id: string;
    tutorId: string;
    title?: string;
    questions?: GameQuestion[];
  }): Promise<Game> {
    const existing = await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    if (existing.status === GameStatus.GENERATING) {
      throw new BadRequestException('Cannot edit a game while generation is in flight.');
    }
    if (existing.status === GameStatus.ARCHIVED) {
      throw new BadRequestException('Archived games are read-only.');
    }

    const data: Prisma.GameUpdateInput = {};
    if (opts.title) data.title = opts.title;
    if (opts.questions) {
      // Re-validate each question shape against the strict schema (defense
      // in depth — the controller already parsed, but this method is also
      // called from tests and internal flows).
      const validated = opts.questions.map((q) => GameQuestionSchema.parse(q));
      const cleaned = enforceTypeInvariants(validated, existing.type);
      data.questionPool = cleaned as unknown as Prisma.InputJsonValue;
    }
    return this.prisma.game.update({ where: { id: opts.id }, data });
  }

  /**
   * Re-run the LLM for a single question in the pool. Replaces just that
   * one entry; preserves the rest of the tutor's edits. Synchronous LLM
   * call (in contrast to whole-pool regen which is queue-driven) because
   * the tutor is actively staring at the modal — a 2-3s wait beats the
   * polling round-trip.
   */
  async regenerateOneQuestion(opts: {
    id: string;
    tutorId: string;
    questionId: string;
  }): Promise<Game> {
    const game = await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    if (game.status === GameStatus.GENERATING || game.status === GameStatus.ARCHIVED) {
      throw new BadRequestException('Game is not editable.');
    }

    const pool = parsePool(game.questionPool);
    const target = pool.find((q) => q.id === opts.questionId);
    if (!target) throw new NotFoundException('Question not found in this game.');

    // Replace the targeted question with a freshly-generated one. The
    // queue's single-question helper shares the prompt builder + Zod
    // validation but runs synchronously (no retry queueing) since the
    // tutor is staring at the modal — quick failure beats a slow retry.
    const newQuestion = await this.queue.regenerateSingle({
      gameId: game.id,
      gameType: game.type,
      locale: game.locale as Language,
    });
    if (!newQuestion) {
      throw new BadRequestException('AI service unavailable — try again shortly.');
    }
    // Carry forward the existing id so client mutation diffs are minimal.
    newQuestion.id = target.id;
    const next = pool.map((q) => (q.id === target.id ? newQuestion : q));
    return this.prisma.game.update({
      where: { id: opts.id },
      data: { questionPool: next as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Re-run the whole pool — same path as initial creation but on an
   * existing row. Counts against quota the same way (each generation
   * costs Anthropic tokens regardless of whether the row is new).
   */
  async regenerateAll(opts: { id: string; tutorId: string }): Promise<Game> {
    const game = await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    if (game.status === GameStatus.ARCHIVED) {
      throw new BadRequestException('Cannot regenerate an archived game.');
    }
    const reservation = await this.quota.reserveGeneration(opts.tutorId);
    if (!reservation.ok) {
      throw new QuotaExceededException({
        cap: reservation.cap,
        used: reservation.used,
        resetsAt: reservation.resetsAt,
      });
    }
    // Reset to GENERATING so the UI shows the same spinner as initial gen.
    const updated = await this.prisma.game.update({
      where: { id: opts.id },
      data: {
        status: GameStatus.GENERATING,
        generationError: null,
        questionPool: [] as unknown as Prisma.InputJsonValue,
      },
    });
    const result = this.queue.enqueue(opts.id, { tutorId: opts.tutorId });
    if (result.breakerOpen) {
      await this.quota.refundGeneration(opts.tutorId);
    }
    return updated;
  }

  async assign(opts: { id: string; tutorId: string }): Promise<Game> {
    const game = await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    if (game.status === GameStatus.GENERATING) {
      throw new BadRequestException('Game is still generating.');
    }
    if (game.status === GameStatus.FAILED) {
      throw new BadRequestException('Game failed to generate — regenerate before assigning.');
    }
    if (game.status === GameStatus.ARCHIVED) {
      throw new BadRequestException('Cannot assign an archived game.');
    }
    const pool = parsePool(game.questionPool);
    if (pool.length === 0) {
      throw new BadRequestException('Cannot assign a game with no questions.');
    }
    return this.prisma.game.update({
      where: { id: opts.id },
      data: { status: GameStatus.ASSIGNED, assignedAt: new Date() },
    });
  }

  /**
   * Soft-delete. Per spec: if attempts exist the game is ARCHIVED (kept
   * for history); otherwise we set deletedAt + status=ARCHIVED both, so
   * later queries can filter by deletedAt or status.
   */
  async softDelete(opts: { id: string; tutorId: string }): Promise<Game> {
    const game = await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    const attemptCount = await this.prisma.attempt.count({ where: { gameId: game.id } });
    return this.prisma.game.update({
      where: { id: opts.id },
      data: {
        status: GameStatus.ARCHIVED,
        deletedAt: attemptCount === 0 ? new Date() : null,
      },
    });
  }
}

// ---- Helpers ------------------------------------------------------------

function defaultTitle(type: GameType): string {
  return type === GameType.FILL_BLANK ? 'Fill-in-the-blank' : 'Timed quiz';
}

export function parsePool(raw: unknown): GameQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: GameQuestion[] = [];
  for (const r of raw) {
    const parsed = GameQuestionSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Length of the persisted answer array in `Attempt.questionResults`. The
 * shape is `{ results: [...] }`; older rows may store a bare array. Returns
 * 0 for anything malformed so the games-summary query stays robust.
 */
function countAnswered(raw: unknown): number {
  if (raw == null) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'object' && 'results' in raw) {
    const r = (raw as { results: unknown }).results;
    return Array.isArray(r) ? r.length : 0;
  }
  return 0;
}

/**
 * Server-side guard: tutors editing in the review modal could in principle
 * remove the `___` token from a fill-blank, or strip distractors from a
 * timed quiz, leaving the question unplayable. Re-establish the shape so
 * the student-side engine doesn't blow up later.
 */
function enforceTypeInvariants(questions: GameQuestion[], type: GameType): GameQuestion[] {
  if (type === GameType.FILL_BLANK) {
    return questions.map((q) => ({
      ...q,
      // Fill-blank prompts must contain `___`. If the tutor's edit removed
      // it, append it so the engine has something to render.
      prompt: q.prompt.includes('___') ? q.prompt : `${q.prompt.trim()} ___`,
      distractors: [],
    }));
  }
  // TIMED_QUIZ — require non-empty distractors. Synthesize a placeholder
  // if the tutor stripped them; they should fix it but a missing array
  // would make the engine crash.
  return questions.map((q) => ({
    ...q,
    distractors:
      q.distractors.length > 0
        ? q.distractors
        : [`${q.answer} (alt 1)`, `${q.answer} (alt 2)`, `${q.answer} (alt 3)`],
  }));
}

/**
 * Synthesize a deterministic q_<id> when the tutor adds a brand-new
 * question via the review modal. Exposed here so test fixtures can use it.
 */
export function newQuestionId(): string {
  return `q_${randomBytes(8).toString('hex')}`;
}
