import type {
  AttemptMonthlyAggregate,
  GameProgress,
  QuestionProgress,
  QuestionResultRecord,
  SparklinePoint,
  StudentProgressTotals,
  TopicProgress,
  TopicTrendPoint,
  TrendDirection,
} from '@tutor-app/shared';

/**
 * Phase 7 progress aggregations — pure functions over already-loaded rows.
 * The service layer is the data loader; this module is the math. Pure
 * functions make property-testing trivial: random inputs in, invariants out.
 */

export interface AttemptInput {
  id: string;
  gameId: string;
  startedAt: Date;
  finishedAt: Date | null;
  score: number;
  livesLost: number;
  results: QuestionResultRecord[];
}

export interface GameInput {
  id: string;
  type: GameProgress['type'];
  title: string;
  status: GameProgress['status'];
}

/** Last N completed attempts only, oldest → newest. */
export const SPARKLINE_LIMIT = 10;
/** Hardest-questions list ceiling and minimum sample size. */
export const HARDEST_QUESTIONS_LIMIT = 5;
export const HARDEST_QUESTIONS_MIN_SAMPLE = 3;
/** Trend needs at least 3 attempts; anything below is "insufficient". */
export const TREND_MIN_ATTEMPTS = 3;
/** Threshold for declaring a trend (compared on the [0,1] accuracy scale). */
export const TREND_DELTA_THRESHOLD = 0.05;

/** Per-attempt accuracy. Returns null for attempts with no answered questions. */
export function attemptAccuracy(a: AttemptInput): number | null {
  if (a.results.length === 0) return null;
  const correct = a.results.reduce((n, r) => n + (r.correct ? 1 : 0), 0);
  return correct / a.results.length;
}

export function attemptCorrectCount(a: AttemptInput): number {
  return a.results.reduce((n, r) => n + (r.correct ? 1 : 0), 0);
}

/**
 * Sparkline = last N completed attempts in chronological order (oldest →
 * newest), with accuracy fraction per attempt.
 */
export function buildSparkline(attempts: AttemptInput[]): SparklinePoint[] {
  const completed = attempts.filter((a) => a.finishedAt !== null);
  // Sort newest-first, take N, reverse so the rendering order is oldest → newest.
  const newestFirst = [...completed].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
  const slice = newestFirst.slice(0, SPARKLINE_LIMIT).reverse();
  return slice.map((a) => ({
    attemptId: a.id,
    startedAt: a.startedAt.toISOString(),
    accuracy: attemptAccuracy(a) ?? 0,
    score: a.score,
  }));
}

/**
 * Trend = sign(average accuracy of the second half − first half of the
 * sparkline), thresholded so noise doesn't flip the direction.
 */
export function trendOf(points: SparklinePoint[]): TrendDirection {
  if (points.length < TREND_MIN_ATTEMPTS) return 'insufficient';
  const mid = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, mid);
  const secondHalf = points.slice(mid);
  const avg = (xs: SparklinePoint[]): number =>
    xs.reduce((s, p) => s + p.accuracy, 0) / xs.length;
  const delta = avg(secondHalf) - avg(firstHalf);
  if (delta > TREND_DELTA_THRESHOLD) return 'improving';
  if (delta < -TREND_DELTA_THRESHOLD) return 'declining';
  return 'stable';
}

export function rollupGame(
  game: GameInput,
  attempts: AttemptInput[],
): GameProgress {
  const completed = attempts.filter((a) => a.finishedAt !== null);
  const sparkline = buildSparkline(completed);

  let latestAccuracy: number | null = null;
  let bestAccuracy: number | null = null;
  let bestScore: number | null = null;
  let lastAttemptAt: Date | null = null;

  for (const a of completed) {
    const acc = attemptAccuracy(a);
    if (acc !== null) {
      if (bestAccuracy === null || acc > bestAccuracy) bestAccuracy = acc;
    }
    if (bestScore === null || a.score > bestScore) bestScore = a.score;
    if (lastAttemptAt === null || a.startedAt > lastAttemptAt) {
      lastAttemptAt = a.startedAt;
      latestAccuracy = acc;
    }
  }

  return {
    id: game.id,
    type: game.type,
    title: game.title,
    status: game.status,
    attemptCount: completed.length,
    lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
    latestAccuracy,
    bestAccuracy,
    bestScore,
    trend: trendOf(sparkline),
    sparkline,
  };
}

/**
 * Per-question accuracy across all of a student's attempts. Uses the
 * persisted `prompt` + `topicTags` from the most recent record (questions
 * are immutable post-assign in practice, but be defensive).
 */
export function rollupQuestions(
  attempts: AttemptInput[],
): QuestionProgress[] {
  // questionId is shared across attempts of the same game (the pool is stable).
  const byId = new Map<
    string,
    {
      gameId: string;
      prompt: string;
      topicTags: string[];
      seen: number;
      correct: number;
      lastSeenAt: Date;
    }
  >();

  for (const a of attempts) {
    for (const r of a.results) {
      const prev = byId.get(r.questionId);
      const answeredAt = new Date(r.answeredAt);
      if (!prev) {
        byId.set(r.questionId, {
          gameId: a.gameId,
          prompt: r.prompt,
          topicTags: r.topicTags ?? [],
          seen: 1,
          correct: r.correct ? 1 : 0,
          lastSeenAt: answeredAt,
        });
      } else {
        prev.seen += 1;
        if (r.correct) prev.correct += 1;
        if (answeredAt > prev.lastSeenAt) {
          prev.lastSeenAt = answeredAt;
          prev.prompt = r.prompt;
          prev.topicTags = r.topicTags ?? prev.topicTags;
        }
      }
    }
  }

  const out: QuestionProgress[] = [];
  for (const [questionId, agg] of byId) {
    out.push({
      questionId,
      gameId: agg.gameId,
      prompt: agg.prompt,
      topicTags: agg.topicTags,
      seenCount: agg.seen,
      correctCount: agg.correct,
      accuracy: agg.seen === 0 ? 0 : agg.correct / agg.seen,
    });
  }
  return out;
}

/** Top N hardest questions: lowest accuracy, min sample size, tiebreak by seenCount desc. */
export function pickHardest(questions: QuestionProgress[]): QuestionProgress[] {
  return [...questions]
    .filter((q) => q.seenCount >= HARDEST_QUESTIONS_MIN_SAMPLE)
    .sort((a, b) => {
      if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
      return b.seenCount - a.seenCount;
    })
    .slice(0, HARDEST_QUESTIONS_LIMIT);
}

/**
 * Per-topic rolling accuracy by UTC month. A question can belong to multiple
 * topics — each (topic × month) bucket sums across all matching answers.
 */
export function rollupTopics(attempts: AttemptInput[]): TopicProgress[] {
  // topic → month-key → { seen, correct }
  const byTopic = new Map<
    string,
    {
      seen: number;
      correct: number;
      months: Map<string, { seen: number; correct: number }>;
    }
  >();

  for (const a of attempts) {
    for (const r of a.results) {
      const tags = r.topicTags ?? [];
      if (tags.length === 0) continue;
      const month = monthKey(new Date(r.answeredAt));
      for (const topic of tags) {
        let bucket = byTopic.get(topic);
        if (!bucket) {
          bucket = { seen: 0, correct: 0, months: new Map() };
          byTopic.set(topic, bucket);
        }
        bucket.seen += 1;
        if (r.correct) bucket.correct += 1;
        let monthBucket = bucket.months.get(month);
        if (!monthBucket) {
          monthBucket = { seen: 0, correct: 0 };
          bucket.months.set(month, monthBucket);
        }
        monthBucket.seen += 1;
        if (r.correct) monthBucket.correct += 1;
      }
    }
  }

  const out: TopicProgress[] = [];
  for (const [topic, agg] of byTopic) {
    const points: TopicTrendPoint[] = [...agg.months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        accuracy: m.seen === 0 ? 0 : m.correct / m.seen,
        sampleSize: m.seen,
      }));
    out.push({
      topic,
      seenCount: agg.seen,
      correctCount: agg.correct,
      accuracy: agg.seen === 0 ? 0 : agg.correct / agg.seen,
      points,
    });
  }
  // Newest-active topic first → tutor sees what the student is working on now.
  return out.sort((a, b) => b.seenCount - a.seenCount);
}

export function computeTotals(attempts: AttemptInput[]): StudentProgressTotals {
  let answered = 0;
  let correct = 0;
  let first: Date | null = null;
  let last: Date | null = null;
  let completed = 0;
  for (const a of attempts) {
    if (a.finishedAt !== null) completed += 1;
    answered += a.results.length;
    for (const r of a.results) {
      if (r.correct) correct += 1;
    }
    if (first === null || a.startedAt < first) first = a.startedAt;
    if (last === null || a.startedAt > last) last = a.startedAt;
  }
  return {
    totalAttempts: attempts.length,
    completedAttempts: completed,
    totalQuestionsAnswered: answered,
    overallAccuracy: answered === 0 ? null : correct / answered,
    firstAttemptAt: first?.toISOString() ?? null,
    lastAttemptAt: last?.toISOString() ?? null,
  };
}

/**
 * Bucket attempts older than `cutoff` into per-UTC-month aggregates. The
 * recent attempts (>= cutoff) flow through the paginated `items` list.
 */
export function aggregateOlderAttempts(
  attempts: AttemptInput[],
  cutoff: Date,
): AttemptMonthlyAggregate[] {
  const buckets = new Map<string, { count: number; accuracySum: number; accuracyN: number }>();
  for (const a of attempts) {
    if (a.startedAt >= cutoff) continue;
    const key = monthKey(a.startedAt);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, accuracySum: 0, accuracyN: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const acc = attemptAccuracy(a);
    if (acc !== null) {
      bucket.accuracySum += acc;
      bucket.accuracyN += 1;
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({
      month,
      attemptCount: b.count,
      avgAccuracy: b.accuracyN === 0 ? null : b.accuracySum / b.accuracyN,
    }));
}

export function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
