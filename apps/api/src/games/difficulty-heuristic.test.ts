import { DEFAULT_DIFFICULTY, MAX_DIFFICULTY, MIN_DIFFICULTY, type GameQuestion } from '@tutor-app/shared';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../attempts/question-sampler';
import {
  assignHeuristicDifficulty,
  hardnessScore,
  isUnratedPool,
} from './difficulty-heuristic';

function q(over: Partial<GameQuestion> = {}): GameQuestion {
  return {
    id: over.id ?? `q_${Math.random().toString(16).slice(2)}`,
    prompt: over.prompt ?? 'She ___ to school.',
    answer: over.answer ?? 'walks',
    distractors: over.distractors ?? [],
    acceptAlternates: over.acceptAlternates ?? [],
    topicTags: over.topicTags ?? ['present-tense'],
    difficulty: over.difficulty ?? DEFAULT_DIFFICULTY,
  };
}

/** Build a pool whose hardnessScore strictly increases with index. */
function ascendingPool(n: number): GameQuestion[] {
  return Array.from({ length: n }, (_, i) =>
    q({ id: `q_${i}`, answer: 'x'.repeat(i + 1), prompt: 'p'.repeat(i + 1) }),
  );
}

describe('hardnessScore', () => {
  it('rises with answer length, word count, prompt length, and distractor count', () => {
    const base = hardnessScore(q({ answer: 'go', prompt: 'a', distractors: [] }));
    expect(hardnessScore(q({ answer: 'gonna', prompt: 'a', distractors: [] }))).toBeGreaterThan(base);
    expect(hardnessScore(q({ answer: 'go go', prompt: 'a', distractors: [] }))).toBeGreaterThan(base);
    expect(hardnessScore(q({ answer: 'go', prompt: 'a longer prompt here', distractors: [] }))).toBeGreaterThan(base);
    expect(hardnessScore(q({ answer: 'go', prompt: 'a', distractors: ['x', 'y', 'z'] }))).toBeGreaterThan(base);
  });
});

describe('assignHeuristicDifficulty', () => {
  it('preserves order, length, and every non-difficulty field', () => {
    const pool = ascendingPool(7);
    const out = assignHeuristicDifficulty(pool);
    expect(out).toHaveLength(7);
    out.forEach((o, i) => {
      expect(o.id).toBe(pool[i]!.id);
      expect(o.prompt).toBe(pool[i]!.prompt);
      expect(o.answer).toBe(pool[i]!.answer);
      expect(o.topicTags).toEqual(pool[i]!.topicTags);
    });
  });

  it('keeps every difficulty within [1,5]', () => {
    const out = assignHeuristicDifficulty(ascendingPool(23));
    for (const o of out) {
      expect(o.difficulty).toBeGreaterThanOrEqual(MIN_DIFFICULTY);
      expect(o.difficulty).toBeLessThanOrEqual(MAX_DIFFICULTY);
    }
  });

  it('spans the full 1..5 range for a pool of ≥5 distinct-score questions', () => {
    const out = assignHeuristicDifficulty(ascendingPool(10));
    const levels = new Set(out.map((o) => o.difficulty));
    expect(levels).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('assigns difficulty monotonically non-decreasing with hardness rank', () => {
    const out = assignHeuristicDifficulty(ascendingPool(15));
    // Pool is built ascending, so difficulty must never decrease across it.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.difficulty).toBeGreaterThanOrEqual(out[i - 1]!.difficulty);
    }
  });

  it('is deterministic + idempotent (re-rating reproduces the same spread)', () => {
    const pool = ascendingPool(12);
    const once = assignHeuristicDifficulty(pool);
    const twice = assignHeuristicDifficulty(once);
    expect(twice.map((o) => o.difficulty)).toEqual(once.map((o) => o.difficulty));
  });

  it('handles the n=1 and empty edge cases', () => {
    expect(assignHeuristicDifficulty([])).toEqual([]);
    const single = assignHeuristicDifficulty([q({ id: 'solo' })]);
    expect(single).toHaveLength(1);
    expect(single[0]!.difficulty).toBe(DEFAULT_DIFFICULTY);
  });

  it('property: random pools (size 5..40) always span >1 level, preserve length, stay in range', () => {
    const rng = seededRng(12345);
    for (let trial = 0; trial < 100; trial++) {
      const n = 5 + Math.floor(rng() * 36);
      const pool = Array.from({ length: n }, (_, i) =>
        q({
          id: `t${trial}_${i}`,
          answer: 'a'.repeat(1 + Math.floor(rng() * 12)),
          prompt: 'p'.repeat(1 + Math.floor(rng() * 40)),
          distractors: Array.from({ length: Math.floor(rng() * 4) }, (_, k) => `d${k}`),
        }),
      );
      const out = assignHeuristicDifficulty(pool);
      expect(out).toHaveLength(n);
      const levels = new Set(out.map((o) => o.difficulty));
      expect(levels.size).toBeGreaterThan(1);
      for (const o of out) {
        expect(o.difficulty).toBeGreaterThanOrEqual(MIN_DIFFICULTY);
        expect(o.difficulty).toBeLessThanOrEqual(MAX_DIFFICULTY);
      }
    }
  });
});

describe('isUnratedPool', () => {
  it('is true when every question sits at the default tier', () => {
    expect(isUnratedPool([q(), q(), q()])).toBe(true);
  });

  it('is false once the pool spans tiers', () => {
    expect(isUnratedPool(assignHeuristicDifficulty(ascendingPool(8)))).toBe(false);
  });

  it('is false for an empty pool (nothing to backfill)', () => {
    expect(isUnratedPool([])).toBe(false);
  });
});
