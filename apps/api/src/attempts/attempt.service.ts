import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type Attempt,
  GameStatus,
  GameType,
  type Game,
  type Prisma,
  type Student,
} from '@prisma/client';
import {
  type GameQuestion,
  GameQuestionSchema,
  QuestionResultRecordSchema,
  QuestionResultsArraySchema,
  type QuestionResultRecord,
  scoreAnswer,
  defaultSessionSize,
  TIMED_QUIZ_LIVES,
  TIMED_QUIZ_PER_QUESTION_SECONDS,
  type Locale,
} from '@tutor-app/shared';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DI token for tests that need a deterministic RNG when sampling
 * questions. Production binds the default (crypto-seeded) sampler.
 */
export const ATTEMPT_SAMPLER = Symbol('ATTEMPT_SAMPLER');
export type Sampler = (opts: {
  pool: readonly GameQuestion[];
  sessionSize: number;
}) => GameQuestion[];

/**
 * Attempt CRUD scoped through the student's share token. Every loader
 * verifies `gameId`/`attemptId` belong to a game on a lesson on the
 * student — cross-token access → null (controller maps to 404).
 *
 * Server-side scoring is source of truth. The per-attempt sampled
 * question IDs + answer keys are persisted on Attempt.questionResults
 * via the sampledIds side-field below.
 */
@Injectable()
export class AttemptService {
  private readonly logger = new Logger(AttemptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Bound to `sampleQuestions` in AttemptsModule. Tests construct
    // the service directly and pass a deterministic sampler.
    @Inject(ATTEMPT_SAMPLER) private readonly sampler: Sampler,
  ) {}

  // ---- Game listing for the dashboard --------------------------------

  /**
   * Returns the student's ASSIGNED (non-deleted) games + a per-game
   * last-played / best-score summary derived from the student's prior
   * attempts. One DB round trip per concern; we don't try to be clever
   * with $queryRaw for v1 — student dashboards are tiny.
   */
  async listAssignedGamesForStudent(student: Student): Promise<
    Array<{
      game: Game;
      lastPlayedAt: Date | null;
      bestScore: number | null;
    }>
  > {
    const games = await this.prisma.game.findMany({
      where: {
        status: GameStatus.ASSIGNED,
        deletedAt: null,
        lesson: { deletedAt: null, student: { id: student.id } },
      },
      orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    if (games.length === 0) return [];
    const attemptRollups = await this.prisma.attempt.groupBy({
      by: ['gameId'],
      where: {
        studentId: student.id,
        gameId: { in: games.map((g) => g.id) },
        finishedAt: { not: null },
      },
      _max: { finishedAt: true, score: true },
    });
    const rollupByGame = new Map(attemptRollups.map((r) => [r.gameId, r]));
    return games.map((game) => {
      const r = rollupByGame.get(game.id);
      return {
        game,
        lastPlayedAt: r?._max.finishedAt ?? null,
        bestScore: r?._max.score ?? null,
      };
    });
  }

  // ---- Start attempt -------------------------------------------------

  /**
   * Begin a new attempt. Samples a per-attempt subset from the game's
   * pool and persists the sampled question IDs + per-id answer keys
   * inside Attempt.questionResults as a header object — the per-answer
   * patches push real result entries onto the same JSON column.
   */
  async startAttempt(opts: {
    student: Student;
    gameId: string;
  }): Promise<{
    attempt: Attempt;
    type: GameType;
    locale: Locale;
    questions: GameQuestion[];
    livesAllowed: number;
    perQuestionSeconds: number;
  }> {
    const game = await this.loadGameForStudent(opts.student.id, opts.gameId);
    if (!game) throw new NotFoundException('Game not found.');
    if (game.status !== GameStatus.ASSIGNED) {
      // A defensive check — ARCHIVED games shouldn't show up on the
      // dashboard, but a stale URL could still target one.
      throw new NotFoundException('Game not found.');
    }
    const pool = parsePool(game.questionPool);
    if (pool.length === 0) {
      throw new BadRequestException('Game has no questions.');
    }

    const sessionSize = this.sessionSizeFor(game.type);
    const sampled = this.sampler({ pool, sessionSize });

    const livesAllowed = game.type === GameType.TIMED_QUIZ ? TIMED_QUIZ_LIVES : 0;
    const perQuestionSeconds =
      game.type === GameType.TIMED_QUIZ ? TIMED_QUIZ_PER_QUESTION_SECONDS : 0;

    // Persist a header at the start so we know which questions are part
    // of this attempt and what their server-known answers are.
    const header: AttemptHeader = {
      sampledIds: sampled.map((q) => q.id),
      // Index of question-key data so we don't have to re-parse the full
      // game pool on every PATCH.
      keys: Object.fromEntries(
        sampled.map((q) => [
          q.id,
          {
            answer: q.answer,
            acceptAlternates: q.acceptAlternates,
            distractors: q.distractors,
            prompt: q.prompt,
            topicTags: q.topicTags,
          },
        ]),
      ),
      results: [],
      gameType: game.type,
      locale: (game.locale as Locale) ?? 'en',
      livesAllowed,
      perQuestionSeconds,
    };

    const attempt = await this.prisma.attempt.create({
      data: {
        gameId: game.id,
        studentId: opts.student.id,
        startedAt: new Date(),
        questionResults: header as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      attempt,
      type: game.type,
      locale: header.locale,
      // Don't ship the answer / acceptAlternates to the client. For
      // TIMED_QUIZ we ship pre-shuffled `choices`; the response shaper
      // in the controller maps GameQuestion → PublicQuestion.
      questions: sampled,
      livesAllowed,
      perQuestionSeconds,
    };
  }

  // ---- Submit answer (idempotent) -----------------------------------

  /**
   * Submit one answer. Idempotent on `(attemptId, questionId)` — a
   * repeat submission returns the prior result and does NOT double-
   * count score / lives. Safe to call from a buffered client retrying
   * after a network blip.
   */
  async submitAnswer(opts: {
    student: Student;
    attemptId: string;
    questionId: string;
    rawAnswer?: string;
    choiceIndex?: number;
    timedOut?: boolean;
  }): Promise<{
    record: QuestionResultRecord;
    scoreSoFar: number;
    livesRemaining?: number;
    gameOver: boolean;
  }> {
    const attempt = await this.loadAttemptForStudent(opts.student.id, opts.attemptId);
    if (!attempt) throw new NotFoundException('Attempt not found.');
    const header = readHeader(attempt.questionResults);
    if (!header) throw new BadRequestException('Attempt is corrupted.');

    // 1. Verify the questionId belongs to THIS attempt's sampled set.
    const key = header.keys[opts.questionId];
    if (!key || !header.sampledIds.includes(opts.questionId)) {
      throw new NotFoundException('Question not in this attempt.');
    }

    // 2. Idempotency: if already answered, return the existing record
    //    without mutating state. This is what makes the IndexedDB
    //    retry-on-reconnect strategy safe.
    const existing = header.results.find((r) => r.questionId === opts.questionId);
    if (existing) {
      return {
        record: existing,
        scoreSoFar: attempt.score,
        livesRemaining:
          header.gameType === GameType.TIMED_QUIZ
            ? Math.max(0, header.livesAllowed - attempt.livesLost)
            : undefined,
        gameOver: this.isGameOver(header, attempt.livesLost, header.results.length),
      };
    }

    // 3. If the attempt has already finished, refuse to push more.
    if (attempt.finishedAt) {
      throw new BadRequestException('Attempt already finished.');
    }

    // 4. Score it.
    let correct = false;
    let rawAnswer = (opts.rawAnswer ?? '').toString();
    let normalizedAnswer = '';
    if (opts.timedOut === true) {
      correct = false;
      rawAnswer = '';
    } else if (header.gameType === GameType.TIMED_QUIZ) {
      if (typeof opts.choiceIndex !== 'number') {
        throw new BadRequestException('TIMED_QUIZ requires choiceIndex or timedOut.');
      }
      // The server holds a pre-shuffled `choices` array on the header.
      // (Frozen at start time so re-shuffles cannot move the target.)
      const choices = header.choicesByQuestion?.[opts.questionId];
      if (!choices) {
        throw new BadRequestException('Choices missing — attempt corrupted.');
      }
      const picked = choices[opts.choiceIndex];
      if (typeof picked !== 'string') {
        throw new BadRequestException('choiceIndex out of range.');
      }
      // Score against the canonical answer.
      const r = scoreAnswer({
        rawAnswer: picked,
        expected: key.answer,
        acceptAlternates: key.acceptAlternates,
        locale: header.locale,
      });
      correct = r.correct;
      rawAnswer = picked;
      normalizedAnswer = r.normalizedActual;
    } else {
      const r = scoreAnswer({
        rawAnswer,
        expected: key.answer,
        acceptAlternates: key.acceptAlternates,
        locale: header.locale,
        // Server scoring stays strict. Web engine may use allowFuzzy
        // for instant feedback, but the persisted truth is exact.
      });
      correct = r.correct;
      normalizedAnswer = r.normalizedActual;
    }

    const record: QuestionResultRecord = QuestionResultRecordSchema.parse({
      questionId: opts.questionId,
      prompt: key.prompt,
      correct,
      rawAnswer,
      normalizedAnswer,
      expectedAnswer: key.answer,
      answeredAt: new Date().toISOString(),
      topicTags: key.topicTags,
      ...(header.gameType === GameType.TIMED_QUIZ
        ? {
            choiceIndex: opts.timedOut ? -1 : (opts.choiceIndex as number),
            timedOut: !!opts.timedOut,
          }
        : {}),
    });

    // 5. Persist. We rewrite the entire header JSON in one update so
    //    score + livesLost + results stay in sync. The Attempt row's
    //    primary key (id) is the natural concurrency boundary — even
    //    if two PATCHes raced for the SAME question, the idempotency
    //    check above + a quick re-read would surface the dup, and we
    //    explicitly de-dup by id one more time here as a safety net.
    const updatedHeader: AttemptHeader = {
      ...header,
      results: [...header.results.filter((r) => r.questionId !== opts.questionId), record],
    };
    const newScore = correct ? attempt.score + 1 : attempt.score;
    const newLives =
      header.gameType === GameType.TIMED_QUIZ && !correct
        ? attempt.livesLost + 1
        : attempt.livesLost;

    await this.prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        score: newScore,
        livesLost: newLives,
        questionResults: updatedHeader as unknown as Prisma.InputJsonValue,
      },
    });

    const livesRemaining =
      header.gameType === GameType.TIMED_QUIZ
        ? Math.max(0, header.livesAllowed - newLives)
        : undefined;
    const gameOver = this.isGameOver(header, newLives, updatedHeader.results.length);

    return { record, scoreSoFar: newScore, livesRemaining, gameOver };
  }

  // ---- Finish (idempotent) ------------------------------------------

  async finishAttempt(opts: {
    student: Student;
    attemptId: string;
  }): Promise<{
    attempt: Attempt;
    bestEver: number;
    totalQuestions: number;
  }> {
    const attempt = await this.loadAttemptForStudent(opts.student.id, opts.attemptId);
    if (!attempt) throw new NotFoundException('Attempt not found.');
    const header = readHeader(attempt.questionResults);
    if (!header) throw new BadRequestException('Attempt is corrupted.');

    let final = attempt;
    if (!attempt.finishedAt) {
      final = await this.prisma.attempt.update({
        where: { id: attempt.id },
        data: { finishedAt: new Date() },
      });
    }
    // bestEver across PRIOR finished attempts (exclude the current one
    // so "you beat your best!" copy on the game-over screen is true).
    const best = await this.prisma.attempt.aggregate({
      where: {
        studentId: opts.student.id,
        gameId: final.gameId,
        finishedAt: { not: null },
        id: { not: final.id },
      },
      _max: { score: true },
    });
    return {
      attempt: final,
      bestEver: best._max.score ?? 0,
      totalQuestions: header.sampledIds.length,
    };
  }

  // ---- Per-attempt helpers (controller maps to wire shapes) ---------

  /**
   * Returns the `choices` array (per question id) the controller can
   * include in the start response — pre-shuffled, server-frozen so the
   * answer endpoint scores against the right index.
   */
  publicChoicesForAttempt(
    attemptId: string,
    student: Student,
  ): Promise<Record<string, string[]>> {
    return this.prisma.attempt
      .findFirst({ where: { id: attemptId, studentId: student.id } })
      .then((a) => {
        if (!a) return {};
        const h = readHeader(a.questionResults);
        return h?.choicesByQuestion ?? {};
      });
  }

  /**
   * Build + persist the per-question shuffled choices array on the
   * attempt header. Called once at start (after sampling) when the
   * game type is TIMED_QUIZ. For FILL_BLANK we skip — no choices.
   *
   * Kept as a separate method instead of inlining so tests can verify
   * the shuffle is server-side (the client never receives the answer
   * apart from its position in this list).
   */
  async freezeChoices(attemptId: string): Promise<void> {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return;
    const header = readHeader(attempt.questionResults);
    if (!header || header.gameType !== GameType.TIMED_QUIZ) return;

    const choicesByQuestion: Record<string, string[]> = {};
    for (const qid of header.sampledIds) {
      const key = header.keys[qid];
      if (!key) continue;
      // Cap distractors at 3 BEFORE adding the answer so the resulting
      // choices array is always max 4 AND always contains the correct
      // answer (even when the LLM gave us 8 distractors). Shuffle the
      // distractors first so the cap is a random pick from the pool.
      const distractors = [...key.distractors];
      for (let i = distractors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = distractors[i]!;
        distractors[i] = distractors[j]!;
        distractors[j] = tmp;
      }
      const merged = [key.answer, ...distractors.slice(0, 3)];
      // Shuffle the final 4 so the correct-answer position is random.
      for (let i = merged.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = merged[i]!;
        merged[i] = merged[j]!;
        merged[j] = tmp;
      }
      choicesByQuestion[qid] = merged;
    }
    const updated: AttemptHeader = { ...header, choicesByQuestion };
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { questionResults: updated as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Sweep abandoned attempts: any unfinished attempt older than the
   * configured threshold is force-finished with its current score so
   * the tutor's progress view doesn't include stuck rows. Returns
   * count, used by the cron's audit metadata.
   */
  async finishAbandoned(now: Date = new Date()): Promise<number> {
    const hours = this.config.get('ATTEMPT_ABANDON_AFTER_HOURS');
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const result = await this.prisma.attempt.updateMany({
      where: { finishedAt: null, startedAt: { lt: cutoff } },
      data: { finishedAt: now },
    });
    return result.count;
  }

  // ---- Internals -----------------------------------------------------

  private sessionSizeFor(type: GameType): number {
    if (type === GameType.FILL_BLANK) {
      return this.config.get('FILL_BLANK_SESSION_SIZE');
    }
    return this.config.get('TIMED_QUIZ_SESSION_SIZE');
  }

  private isGameOver(
    header: AttemptHeader,
    livesLost: number,
    answeredCount: number,
  ): boolean {
    if (header.gameType === GameType.FILL_BLANK) {
      return answeredCount >= header.sampledIds.length;
    }
    // TIMED_QUIZ: lives exhausted, OR (rarely) the whole sampled pool
    // ran out — spec calls for infinite questions but the v1 sampler
    // is bounded, so we surface the same "game over" signal.
    if (livesLost >= header.livesAllowed) return true;
    return answeredCount >= header.sampledIds.length;
  }

  /**
   * Token-scoped game loader. Walks Game → Lesson → Student and
   * verifies `student.id === student-from-token`. Returns null on
   * miss (controller maps to 404).
   */
  private async loadGameForStudent(
    studentId: string,
    gameId: string,
  ): Promise<Game | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        lesson: { select: { deletedAt: true, student: { select: { id: true } } } },
      },
    });
    if (!game) return null;
    if (!game.lesson || game.lesson.deletedAt !== null) return null;
    if (game.lesson.student.id !== studentId) return null;
    return game;
  }

  /**
   * Token-scoped attempt loader. Verifies `attempt.studentId === student.id`.
   */
  private async loadAttemptForStudent(
    studentId: string,
    attemptId: string,
  ): Promise<Attempt | null> {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId } });
    if (!a || a.studentId !== studentId) return null;
    return a;
  }
}

// ---- Persisted header shape ------------------------------------------

/**
 * Internal JSON shape stored on `Attempt.questionResults`. The header
 * carries everything the server needs to score later answers (sampled
 * IDs + per-id keys + frozen TIMED_QUIZ choices) and the running per-
 * question results list.
 *
 * We don't expose this to clients directly — the controller projects
 * to the public Zod shapes (PublicQuestion / SubmitAnswerResponse).
 */
interface AttemptHeader {
  sampledIds: string[];
  keys: Record<string, AttemptQuestionKey>;
  results: QuestionResultRecord[];
  gameType: GameType;
  locale: Locale;
  livesAllowed: number;
  perQuestionSeconds: number;
  /** TIMED_QUIZ only — pre-shuffled choices the client renders. */
  choicesByQuestion?: Record<string, string[]>;
}

interface AttemptQuestionKey {
  answer: string;
  acceptAlternates: string[];
  distractors: string[];
  prompt: string;
  topicTags: string[];
}

function readHeader(raw: unknown): AttemptHeader | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Partial<AttemptHeader>;
  if (!Array.isArray(obj.sampledIds) || typeof obj.keys !== 'object') return null;
  // Coerce results array through the strict schema, dropping anything
  // we can't parse. Forward-compat: future versions can add fields.
  const results = QuestionResultsArraySchema.safeParse(obj.results ?? []);
  return {
    sampledIds: obj.sampledIds as string[],
    keys: obj.keys as Record<string, AttemptQuestionKey>,
    results: results.success ? results.data : [],
    gameType: obj.gameType as GameType,
    locale: (obj.locale as Locale) ?? 'en',
    livesAllowed: typeof obj.livesAllowed === 'number' ? obj.livesAllowed : 0,
    perQuestionSeconds:
      typeof obj.perQuestionSeconds === 'number' ? obj.perQuestionSeconds : 0,
    choicesByQuestion: obj.choicesByQuestion as Record<string, string[]> | undefined,
  };
}

function parsePool(raw: unknown): GameQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: GameQuestion[] = [];
  for (const r of raw) {
    const parsed = GameQuestionSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// Re-export the unused-fallback for tests that don't want to compute it.
export { defaultSessionSize };
