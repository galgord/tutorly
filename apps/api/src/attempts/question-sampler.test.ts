import { describe, expect, it } from 'vitest';
import type { GameQuestion } from '@tutor-app/shared';
import { sampleQuestions, seededRng } from './question-sampler';

function pool(n: number): GameQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q_${i}`,
    prompt: `Q${i}`,
    answer: `A${i}`,
    distractors: [],
    acceptAlternates: [],
    topicTags: [],
  }));
}

describe('sampleQuestions', () => {
  it('returns at most sessionSize items', () => {
    const out = sampleQuestions({ pool: pool(30), sessionSize: 10 });
    expect(out).toHaveLength(10);
  });

  it('clamps to pool length when sessionSize > poolSize', () => {
    const out = sampleQuestions({ pool: pool(3), sessionSize: 10 });
    expect(out).toHaveLength(3);
  });

  it('returns empty on empty pool', () => {
    expect(sampleQuestions({ pool: [], sessionSize: 10 })).toEqual([]);
  });

  it('returns empty when sessionSize ≤ 0', () => {
    expect(sampleQuestions({ pool: pool(10), sessionSize: 0 })).toEqual([]);
    expect(sampleQuestions({ pool: pool(10), sessionSize: -5 })).toEqual([]);
  });

  it('produces no duplicate ids within a sampled session', () => {
    for (let seed = 1; seed < 30; seed++) {
      const out = sampleQuestions({ pool: pool(30), sessionSize: 15, rng: seededRng(seed) });
      const ids = new Set(out.map((q) => q.id));
      expect(ids.size).toBe(out.length);
    }
  });

  it('is deterministic given the same seed', () => {
    const a = sampleQuestions({ pool: pool(30), sessionSize: 10, rng: seededRng(42) });
    const b = sampleQuestions({ pool: pool(30), sessionSize: 10, rng: seededRng(42) });
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });

  it('different seeds → different orders (overwhelmingly likely)', () => {
    const a = sampleQuestions({ pool: pool(30), sessionSize: 10, rng: seededRng(1) });
    const b = sampleQuestions({ pool: pool(30), sessionSize: 10, rng: seededRng(2) });
    expect(a.map((q) => q.id)).not.toEqual(b.map((q) => q.id));
  });

  it('default crypto RNG returns the right size + no duplicates', () => {
    // No seed → exercises the crypto-default codepath.
    const out = sampleQuestions({ pool: pool(50), sessionSize: 20 });
    expect(out).toHaveLength(20);
    expect(new Set(out.map((q) => q.id)).size).toBe(20);
  });

  it('floors a non-integer sessionSize', () => {
    const out = sampleQuestions({ pool: pool(20), sessionSize: 5.9 });
    expect(out).toHaveLength(5);
  });

  it('uniform-ish: many runs hit a variety of starting ids', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const [first] = sampleQuestions({ pool: pool(10), sessionSize: 1, rng: seededRng(i + 1) });
      counts.set(first!.id, (counts.get(first!.id) ?? 0) + 1);
    }
    // Every id should appear at least a few times across 1000 draws.
    expect(counts.size).toBe(10);
    for (const v of counts.values()) {
      expect(v).toBeGreaterThan(20);
    }
  });
});
