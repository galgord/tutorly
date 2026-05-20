import { Injectable } from '@nestjs/common';
import { GameStatus, type Attempt } from '@prisma/client';
import {
  QuestionResultsArraySchema,
  type AttemptHistoryItem,
  type AttemptHistoryResponse,
  type StudentGameProgressItem,
  type StudentProgressResponse,
} from '@tutor-app/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  aggregateOlderAttempts,
  attemptAccuracy,
  attemptCorrectCount,
  computeTotals,
  pickHardest,
  rollupGame,
  rollupQuestions,
  rollupTopics,
  type AttemptInput,
} from './progress.aggregations';

/** Recent paginated window cutoff: anything older rolls into monthly buckets. */
export const RECENT_ATTEMPT_WINDOW_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6mo

/**
 * Phase 7 progress aggregation service. Tenant-scoping is delegated to the
 * caller (the controller verifies the student belongs to the session's
 * tutor via `StudentService.getForTutorOrFail` before calling in).
 *
 * The math lives in `progress.aggregations.ts` so it stays pure +
 * exhaustively unit-tested; this module is just the DB loader + projection
 * to wire shapes.
 */
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentProgress(studentId: string): Promise<StudentProgressResponse> {
    const [attemptRows, gameRows] = await this.prisma.$transaction([
      this.prisma.attempt.findMany({
        where: { studentId },
        orderBy: { startedAt: 'desc' },
      }),
      // All games this student could have played — surfaces ASSIGNED games
      // with zero attempts too so the dashboard shows "not played yet"
      // rather than silently omitting them.
      this.prisma.game.findMany({
        where: {
          status: { in: [GameStatus.ASSIGNED, GameStatus.ARCHIVED] },
          deletedAt: null,
          lesson: { studentId, deletedAt: null },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const attemptsByGame = new Map<string, AttemptInput[]>();
    const allAttempts: AttemptInput[] = [];
    for (const a of attemptRows) {
      const input = toAttemptInput(a);
      allAttempts.push(input);
      let bucket = attemptsByGame.get(a.gameId);
      if (!bucket) {
        bucket = [];
        attemptsByGame.set(a.gameId, bucket);
      }
      bucket.push(input);
    }

    const games = gameRows.map((g) =>
      rollupGame(
        { id: g.id, type: g.type, title: g.title, status: g.status },
        attemptsByGame.get(g.id) ?? [],
      ),
    );

    // Attempts whose game's lesson got soft-deleted aren't surfaced — the
    // tutor can't navigate to the lesson anyway. Topic + totals still
    // include them so the student's overall accuracy stays honest.

    return {
      studentId,
      totals: computeTotals(allAttempts),
      games,
      topics: rollupTopics(allAttempts),
      hardestQuestions: pickHardest(rollupQuestions(allAttempts)),
    };
  }

  /**
   * Phase 12 read-only adaptive view: per-ASSIGNED-game current level + plays +
   * due-review count + bank size. Tenant-scoping is the caller's job (the
   * controller verifies the student belongs to the session's tutor first).
   */
  async getStudentGameProgress(
    studentId: string,
    now: Date = new Date(),
  ): Promise<StudentGameProgressItem[]> {
    const games = await this.prisma.game.findMany({
      where: { status: GameStatus.ASSIGNED, deletedAt: null, lesson: { studentId, deletedAt: null } },
      orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, title: true, type: true, questionPool: true, poolTargetSize: true },
    });
    if (games.length === 0) return [];
    const gameIds = games.map((g) => g.id);
    const [progressRows, dueRows] = await this.prisma.$transaction([
      this.prisma.studentGameProgress.findMany({
        where: { studentId, gameId: { in: gameIds } },
        select: { gameId: true, currentLevel: true, playsCompleted: true, lastPlayedAt: true },
      }),
      this.prisma.questionReview.findMany({
        where: { studentId, gameId: { in: gameIds }, dueAt: { lte: now } },
        select: { gameId: true },
      }),
    ]);
    const progByGame = new Map(progressRows.map((p) => [p.gameId, p]));
    const dueByGame = new Map<string, number>();
    for (const r of dueRows) dueByGame.set(r.gameId, (dueByGame.get(r.gameId) ?? 0) + 1);
    return games.map((g) => {
      const p = progByGame.get(g.id);
      const poolSize = Array.isArray(g.questionPool) ? g.questionPool.length : 0;
      return {
        gameId: g.id,
        title: g.title,
        type: g.type,
        currentLevel: p?.currentLevel ?? 1,
        playsCompleted: p?.playsCompleted ?? 0,
        lastPlayedAt: p?.lastPlayedAt ? p.lastPlayedAt.toISOString() : null,
        dueReviewCount: dueByGame.get(g.id) ?? 0,
        poolSize,
        poolTargetSize: g.poolTargetSize,
      };
    });
  }

  async listAttempts(opts: {
    studentId: string;
    page: number;
    limit: number;
    now?: Date;
  }): Promise<AttemptHistoryResponse> {
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - RECENT_ATTEMPT_WINDOW_MS);

    // Pull the lot — single student, bounded by data volume in practice.
    // The 6-month buckets are computed in-process from rows past the cutoff.
    const all = await this.prisma.attempt.findMany({
      where: { studentId: opts.studentId },
      include: { game: { select: { id: true, title: true, type: true } } },
      orderBy: { startedAt: 'desc' },
    });

    const recent = all.filter((a) => a.startedAt >= cutoff);
    const totalRecent = recent.length;
    const start = (opts.page - 1) * opts.limit;
    const slice = recent.slice(start, start + opts.limit);

    const items: AttemptHistoryItem[] = slice.map((a) => {
      const input = toAttemptInput(a);
      const accuracy = attemptAccuracy(input);
      return {
        id: a.id,
        gameId: a.gameId,
        gameTitle: a.game.title,
        gameType: a.game.type,
        startedAt: a.startedAt.toISOString(),
        finishedAt: a.finishedAt?.toISOString() ?? null,
        score: a.score,
        livesLost: a.livesLost,
        questionsAnswered: input.results.length,
        correctCount: attemptCorrectCount(input),
        accuracy,
        results: input.results.map((r) => ({
          questionId: r.questionId,
          prompt: r.prompt,
          correct: r.correct,
          rawAnswer: r.rawAnswer,
          expectedAnswer: r.expectedAnswer,
          topicTags: r.topicTags,
          answeredAt: r.answeredAt,
          timedOut: r.timedOut,
        })),
      };
    });

    const monthlyAggregates = aggregateOlderAttempts(
      all.map(toAttemptInput),
      cutoff,
    );

    return {
      items,
      page: opts.page,
      limit: opts.limit,
      totalRecent,
      hasMore: start + opts.limit < totalRecent,
      monthlyAggregates,
      monthlyCutoff: cutoff.toISOString(),
    };
  }
}

function toAttemptInput(a: Attempt): AttemptInput {
  // The persisted header carries a `results` array; everything else (sampled
  // IDs, answer keys) we don't need for aggregation. Parse defensively so a
  // malformed header doesn't poison the aggregation.
  const header = parseHeader(a.questionResults);
  return {
    id: a.id,
    gameId: a.gameId,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    score: a.score,
    livesLost: a.livesLost,
    results: header,
  };
}

function parseHeader(raw: unknown): AttemptInput['results'] {
  if (!raw || typeof raw !== 'object') return [];
  // Persisted shape: either { results: [...], ... } (Phase 6 header) or a
  // raw array (defensive — older test fixtures may have used the bare list).
  const candidate = Array.isArray(raw)
    ? raw
    : (raw as { results?: unknown }).results;
  if (!Array.isArray(candidate)) return [];
  const parsed = QuestionResultsArraySchema.safeParse(candidate);
  return parsed.success ? parsed.data : [];
}

