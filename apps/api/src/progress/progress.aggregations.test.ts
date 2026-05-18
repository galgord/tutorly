import { describe, expect, it } from 'vitest';
import type { QuestionResultRecord } from '@tutor-app/shared';
import {
  aggregateOlderAttempts,
  attemptAccuracy,
  attemptCorrectCount,
  buildSparkline,
  computeTotals,
  HARDEST_QUESTIONS_LIMIT,
  HARDEST_QUESTIONS_MIN_SAMPLE,
  monthKey,
  pickHardest,
  rollupGame,
  rollupQuestions,
  rollupTopics,
  SPARKLINE_LIMIT,
  TREND_DELTA_THRESHOLD,
  trendOf,
  type AttemptInput,
  type GameInput,
} from './progress.aggregations';

const ISO = (s: string) => new Date(s);

function mkResult(over: Partial<QuestionResultRecord>): QuestionResultRecord {
  return {
    questionId: over.questionId ?? 'q1',
    prompt: over.prompt ?? 'prompt',
    correct: over.correct ?? true,
    rawAnswer: over.rawAnswer ?? '',
    normalizedAnswer: over.normalizedAnswer ?? '',
    expectedAnswer: over.expectedAnswer ?? '',
    answeredAt: over.answeredAt ?? '2026-05-01T00:00:00.000Z',
    topicTags: over.topicTags ?? [],
    choiceIndex: over.choiceIndex,
    timedOut: over.timedOut,
  };
}

function mkAttempt(over: Partial<AttemptInput> = {}): AttemptInput {
  return {
    id: over.id ?? 'a1',
    gameId: over.gameId ?? 'g1',
    startedAt: over.startedAt ?? ISO('2026-05-01T00:00:00Z'),
    // Use `in` so an explicit `null` (mid-attempt) wins over the default.
    finishedAt: 'finishedAt' in over ? over.finishedAt! : ISO('2026-05-01T00:05:00Z'),
    score: over.score ?? 0,
    livesLost: over.livesLost ?? 0,
    results: over.results ?? [],
  };
}

describe('attemptAccuracy / attemptCorrectCount', () => {
  it('returns null when there are no results', () => {
    expect(attemptAccuracy(mkAttempt())).toBeNull();
  });

  it('returns the correctness fraction', () => {
    const a = mkAttempt({
      results: [
        mkResult({ correct: true }),
        mkResult({ correct: true }),
        mkResult({ correct: false }),
        mkResult({ correct: false }),
      ],
    });
    expect(attemptAccuracy(a)).toBe(0.5);
    expect(attemptCorrectCount(a)).toBe(2);
  });
});

describe('buildSparkline', () => {
  it('returns empty when no completed attempts', () => {
    expect(buildSparkline([mkAttempt({ finishedAt: null })])).toEqual([]);
  });

  it('returns last N attempts oldest → newest', () => {
    const attempts = Array.from({ length: 15 }, (_, i) =>
      mkAttempt({
        id: `a${i}`,
        startedAt: ISO(`2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
        score: i,
        results: [mkResult({ correct: true })],
      }),
    );
    const sparkline = buildSparkline(attempts);
    expect(sparkline.length).toBe(SPARKLINE_LIMIT);
    // Last N (indices 5..14), reversed back to oldest → newest.
    expect(sparkline.map((p) => p.attemptId)).toEqual(
      attempts.slice(5).map((a) => a.id),
    );
  });
});

describe('trendOf', () => {
  it('insufficient when fewer than 3 points', () => {
    expect(trendOf([])).toBe('insufficient');
    expect(trendOf([{ attemptId: 'x', startedAt: '', accuracy: 0.5, score: 0 }])).toBe('insufficient');
  });

  const pt = (acc: number) => ({ attemptId: 'x', startedAt: '', accuracy: acc, score: 0 });

  it('improving when second half average > first half by threshold', () => {
    expect(trendOf([pt(0.2), pt(0.2), pt(0.8), pt(0.8)])).toBe('improving');
  });

  it('declining when second half average < first half by threshold', () => {
    expect(trendOf([pt(0.9), pt(0.9), pt(0.1), pt(0.1)])).toBe('declining');
  });

  it('stable when the delta is within ±threshold', () => {
    const delta = TREND_DELTA_THRESHOLD - 0.001;
    expect(trendOf([pt(0.5), pt(0.5), pt(0.5 + delta), pt(0.5 + delta)])).toBe('stable');
  });
});

describe('rollupGame', () => {
  const game: GameInput = { id: 'g1', type: 'FILL_BLANK', title: 'Verbs', status: 'ASSIGNED' };

  it('zeros out when no attempts', () => {
    const out = rollupGame(game, []);
    expect(out.attemptCount).toBe(0);
    expect(out.bestAccuracy).toBeNull();
    expect(out.latestAccuracy).toBeNull();
    expect(out.bestScore).toBeNull();
    expect(out.trend).toBe('insufficient');
    expect(out.sparkline).toEqual([]);
  });

  it('best accuracy ≥ latest accuracy when a prior attempt was higher', () => {
    const earlier = mkAttempt({
      id: 'old',
      startedAt: ISO('2026-04-01T00:00:00Z'),
      score: 9,
      results: Array.from({ length: 10 }, () => mkResult({ correct: true })),
    });
    const recent = mkAttempt({
      id: 'new',
      startedAt: ISO('2026-05-01T00:00:00Z'),
      score: 5,
      results: Array.from({ length: 10 }, (_, i) => mkResult({ correct: i < 5 })),
    });
    const out = rollupGame(game, [earlier, recent]);
    expect(out.bestAccuracy).toBe(1);
    expect(out.latestAccuracy).toBe(0.5);
    expect(out.bestScore).toBe(9);
    expect(out.attemptCount).toBe(2);
    expect(out.lastAttemptAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('excludes unfinished attempts from the rollup', () => {
    const live = mkAttempt({ id: 'live', finishedAt: null, score: 100 });
    const done = mkAttempt({
      id: 'done',
      score: 3,
      results: [mkResult({ correct: true }), mkResult({ correct: false })],
    });
    const out = rollupGame(game, [live, done]);
    expect(out.attemptCount).toBe(1);
    expect(out.bestScore).toBe(3);
  });
});

describe('rollupQuestions / pickHardest', () => {
  it('aggregates accuracy per question across attempts', () => {
    const attempts = [
      mkAttempt({ id: 'a1', results: [mkResult({ questionId: 'q1', correct: true }), mkResult({ questionId: 'q2', correct: false })] }),
      mkAttempt({ id: 'a2', results: [mkResult({ questionId: 'q1', correct: false }), mkResult({ questionId: 'q2', correct: false })] }),
      mkAttempt({ id: 'a3', results: [mkResult({ questionId: 'q1', correct: true }), mkResult({ questionId: 'q2', correct: false })] }),
    ];
    const out = rollupQuestions(attempts);
    const q1 = out.find((q) => q.questionId === 'q1')!;
    const q2 = out.find((q) => q.questionId === 'q2')!;
    expect(q1.seenCount).toBe(3);
    expect(q1.correctCount).toBe(2);
    expect(q1.accuracy).toBeCloseTo(2 / 3);
    expect(q2.accuracy).toBe(0);
  });

  it('hardest excludes questions below the sample threshold', () => {
    const attempts = [
      mkAttempt({ results: [mkResult({ questionId: 'rare', correct: false })] }),
      mkAttempt({
        results: Array.from({ length: HARDEST_QUESTIONS_MIN_SAMPLE }, () =>
          mkResult({ questionId: 'hard', correct: false }),
        ),
      }),
    ];
    const hardest = pickHardest(rollupQuestions(attempts));
    expect(hardest.map((q) => q.questionId)).toEqual(['hard']);
  });

  it('hardest is capped at HARDEST_QUESTIONS_LIMIT, sorted ascending accuracy', () => {
    const attempts: AttemptInput[] = [];
    for (let i = 0; i < HARDEST_QUESTIONS_LIMIT + 3; i++) {
      attempts.push(
        mkAttempt({
          id: `a${i}`,
          results: Array.from({ length: HARDEST_QUESTIONS_MIN_SAMPLE }, () =>
            mkResult({ questionId: `q${i}`, correct: i % 2 === 0 }),
          ),
        }),
      );
    }
    const hardest = pickHardest(rollupQuestions(attempts));
    expect(hardest.length).toBe(HARDEST_QUESTIONS_LIMIT);
    for (let i = 1; i < hardest.length; i++) {
      expect(hardest[i]!.accuracy).toBeGreaterThanOrEqual(hardest[i - 1]!.accuracy);
    }
  });
});

describe('rollupTopics', () => {
  it('buckets results per topic per UTC month', () => {
    const attempts = [
      mkAttempt({
        results: [
          mkResult({
            answeredAt: '2026-04-15T00:00:00Z',
            topicTags: ['ser-estar', 'present'],
            correct: true,
          }),
          mkResult({
            answeredAt: '2026-04-20T00:00:00Z',
            topicTags: ['ser-estar'],
            correct: false,
          }),
          mkResult({
            answeredAt: '2026-05-02T00:00:00Z',
            topicTags: ['ser-estar'],
            correct: true,
          }),
        ],
      }),
    ];
    const out = rollupTopics(attempts);
    const ser = out.find((t) => t.topic === 'ser-estar')!;
    expect(ser.seenCount).toBe(3);
    expect(ser.correctCount).toBe(2);
    expect(ser.points.map((p) => p.month)).toEqual(['2026-04', '2026-05']);
    expect(ser.points[0]).toEqual({ month: '2026-04', accuracy: 0.5, sampleSize: 2 });
    expect(ser.points[1]).toEqual({ month: '2026-05', accuracy: 1, sampleSize: 1 });
  });

  it('drops results with no topic tags', () => {
    const out = rollupTopics([mkAttempt({ results: [mkResult({ topicTags: [] })] })]);
    expect(out).toEqual([]);
  });
});

describe('computeTotals', () => {
  it('sums across all attempts including in-progress ones', () => {
    const live = mkAttempt({ id: 'live', finishedAt: null, results: [mkResult({ correct: true })] });
    const done = mkAttempt({
      id: 'done',
      results: [mkResult({ correct: true }), mkResult({ correct: false })],
    });
    const totals = computeTotals([live, done]);
    expect(totals.totalAttempts).toBe(2);
    expect(totals.completedAttempts).toBe(1);
    expect(totals.totalQuestionsAnswered).toBe(3);
    expect(totals.overallAccuracy).toBeCloseTo(2 / 3);
  });

  it('null overallAccuracy when no questions answered', () => {
    expect(computeTotals([]).overallAccuracy).toBeNull();
  });
});

describe('aggregateOlderAttempts', () => {
  it('buckets per UTC month and excludes recent attempts', () => {
    const cutoff = ISO('2026-04-01T00:00:00Z');
    const attempts = [
      mkAttempt({ id: 'old1', startedAt: ISO('2025-12-10T00:00:00Z'), results: [mkResult({ correct: true })] }),
      mkAttempt({ id: 'old2', startedAt: ISO('2025-12-20T00:00:00Z'), results: [mkResult({ correct: false }), mkResult({ correct: false })] }),
      mkAttempt({ id: 'old3', startedAt: ISO('2026-01-05T00:00:00Z'), results: [mkResult({ correct: true })] }),
      mkAttempt({ id: 'recent', startedAt: ISO('2026-05-01T00:00:00Z'), results: [mkResult({ correct: true })] }),
    ];
    const out = aggregateOlderAttempts(attempts, cutoff);
    expect(out.map((m) => m.month)).toEqual(['2025-12', '2026-01']);
    // old1 = 1/1, old2 = 0/2 → per-attempt avg = (1 + 0) / 2 = 0.5
    expect(out[0]).toEqual({ month: '2025-12', attemptCount: 2, avgAccuracy: 0.5 });
    expect(out[1]).toEqual({ month: '2026-01', attemptCount: 1, avgAccuracy: 1 });
  });

  it('avgAccuracy is null when no answered questions in a bucket', () => {
    const cutoff = ISO('2026-04-01T00:00:00Z');
    const out = aggregateOlderAttempts(
      [mkAttempt({ startedAt: ISO('2026-01-01T00:00:00Z'), results: [] })],
      cutoff,
    );
    expect(out[0]!.avgAccuracy).toBeNull();
  });
});

describe('monthKey', () => {
  it('always emits YYYY-MM in UTC', () => {
    expect(monthKey(new Date('2026-01-31T23:00:00Z'))).toBe('2026-01');
    expect(monthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});

// ---- Property test: invariants over random shapes ----------------------

describe('aggregation invariants (property-style)', () => {
  function randomAttempts(seed: number, n: number): AttemptInput[] {
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const attempts: AttemptInput[] = [];
    for (let i = 0; i < n; i++) {
      const qCount = 1 + Math.floor(rand() * 5);
      const results: QuestionResultRecord[] = [];
      for (let q = 0; q < qCount; q++) {
        results.push(
          mkResult({
            questionId: `q${Math.floor(rand() * 4)}`,
            correct: rand() > 0.5,
            answeredAt: new Date(2026, Math.floor(rand() * 12), 1).toISOString(),
            topicTags: rand() > 0.5 ? ['t1'] : ['t2'],
          }),
        );
      }
      attempts.push(
        mkAttempt({
          id: `a${i}`,
          startedAt: new Date(2026, Math.floor(rand() * 12), 1),
          finishedAt: rand() > 0.3 ? new Date() : null,
          score: results.reduce((s, r) => s + (r.correct ? 1 : 0), 0),
          results,
        }),
      );
    }
    return attempts;
  }

  it('totals.totalQuestionsAnswered equals sum of attempt result lengths', () => {
    for (const seed of [1, 7, 42, 100, 2026]) {
      const attempts = randomAttempts(seed, 20);
      const totals = computeTotals(attempts);
      const expected = attempts.reduce((s, a) => s + a.results.length, 0);
      expect(totals.totalQuestionsAnswered).toBe(expected);
    }
  });

  it('per-game attemptCount equals number of completed attempts for that game', () => {
    for (const seed of [3, 11, 99]) {
      const attempts = randomAttempts(seed, 20);
      const game: GameInput = { id: 'g1', type: 'FILL_BLANK', title: 't', status: 'ASSIGNED' };
      const out = rollupGame(game, attempts);
      expect(out.attemptCount).toBe(attempts.filter((a) => a.finishedAt !== null).length);
    }
  });

  it('hardest list is sorted ascending by accuracy and respects the limit', () => {
    for (const seed of [5, 13, 21]) {
      const attempts = randomAttempts(seed, 30);
      const hardest = pickHardest(rollupQuestions(attempts));
      expect(hardest.length).toBeLessThanOrEqual(HARDEST_QUESTIONS_LIMIT);
      for (let i = 1; i < hardest.length; i++) {
        expect(hardest[i]!.accuracy).toBeGreaterThanOrEqual(hardest[i - 1]!.accuracy);
      }
      // Each hardest entry meets the sample threshold.
      for (const q of hardest) {
        expect(q.seenCount).toBeGreaterThanOrEqual(HARDEST_QUESTIONS_MIN_SAMPLE);
      }
    }
  });

  it('per-topic sums equal sum of monthly sums', () => {
    for (const seed of [2, 8, 16]) {
      const out = rollupTopics(randomAttempts(seed, 25));
      for (const topic of out) {
        const seenFromMonths = topic.points.reduce((s, p) => s + p.sampleSize, 0);
        expect(seenFromMonths).toBe(topic.seenCount);
      }
    }
  });
});
