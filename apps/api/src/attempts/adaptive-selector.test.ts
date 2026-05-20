import { type GameQuestion } from '@tutor-app/shared';
import { describe, expect, it } from 'vitest';
import { selectAttemptQuestions } from './adaptive-selector';
import { seededRng } from './question-sampler';

function q(id: string, difficulty: number): GameQuestion {
  return {
    id,
    prompt: `${id} ___`,
    answer: id,
    distractors: [],
    acceptAlternates: [],
    topicTags: [],
    difficulty,
  };
}

/** Pool of `n` questions whose difficulty cycles 1..5. */
function pool(n: number): GameQuestion[] {
  return Array.from({ length: n }, (_, i) => q(`q${i}`, ((i % 5) + 1)));
}

const rng = () => seededRng(7);

describe('selectAttemptQuestions', () => {
  it('returns min(sessionSize, pool) distinct questions, all tagged new when nothing seen', () => {
    const sel = selectAttemptQuestions({
      pool: pool(10),
      sessionSize: 5,
      level: 3,
      seen: new Set(),
      rng: rng(),
    });
    expect(sel.questions).toHaveLength(5);
    expect(new Set(sel.questions.map((x) => x.id)).size).toBe(5);
    expect(sel.questions.every((x) => sel.bucketByQuestion[x.id] === 'new')).toBe(true);
    expect(sel.reviewQuestionIds).toEqual([]);
  });

  it('prefers questions at the target difficulty (closest band first)', () => {
    const p = [q('a', 1), q('b', 1), q('c', 5), q('d', 5), q('e', 3)];
    const sel = selectAttemptQuestions({
      pool: p,
      sessionSize: 2,
      level: 1,
      seen: new Set(),
      rng: rng(),
    });
    // Only the two level-1 questions are at distance 0 from level 1.
    expect(new Set(sel.questions.map((x) => x.id))).toEqual(new Set(['a', 'b']));
  });

  it('widens the band when no questions sit exactly at the level', () => {
    const p = [q('a', 5), q('b', 5), q('c', 4)];
    const sel = selectAttemptQuestions({
      pool: p,
      sessionSize: 2,
      level: 1, // nothing at 1; nearest is 4
      seen: new Set(),
      rng: rng(),
    });
    expect(sel.questions).toHaveLength(2);
    // The distance-3 question (difficulty 4) is closest and must be included.
    expect(sel.questions.map((x) => x.id)).toContain('c');
  });

  it('does not repeat seen questions until the unseen pool is exhausted', () => {
    const p = pool(6);
    const seen = new Set(['q0', 'q1', 'q2']);
    const sel = selectAttemptQuestions({
      pool: p,
      sessionSize: 3,
      level: 3,
      seen,
      rng: rng(),
    });
    // All three picks come from the unseen half.
    expect(sel.questions.every((x) => !seen.has(x.id))).toBe(true);
    expect(sel.questions.every((x) => sel.bucketByQuestion[x.id] === 'new')).toBe(true);
  });

  it('recycles seen questions (tagged recycle) once the unseen pool is drained', () => {
    const p = pool(3);
    const seen = new Set(['q0', 'q1', 'q2']);
    const sel = selectAttemptQuestions({
      pool: p,
      sessionSize: 3,
      level: 2,
      seen,
      rng: rng(),
    });
    expect(sel.questions).toHaveLength(3);
    expect(sel.questions.every((x) => sel.bucketByQuestion[x.id] === 'recycle')).toBe(true);
  });

  it('never returns empty for a non-empty pool, even when sessionSize exceeds it', () => {
    const sel = selectAttemptQuestions({
      pool: pool(1),
      sessionSize: 10,
      level: 4,
      seen: new Set(),
      rng: rng(),
    });
    expect(sel.questions).toHaveLength(1);
  });

  it('blends due reviews up to round(N * reviewFraction), capped by available due items', () => {
    const p = pool(10);
    const due = [p[0]!, p[1]!, p[2]!]; // 3 due
    const sel = selectAttemptQuestions({
      pool: p,
      sessionSize: 10,
      level: 3,
      seen: new Set(),
      dueReviews: due,
      reviewFraction: 0.3, // round(10 * 0.3) = 3
      rng: rng(),
    });
    expect(sel.reviewQuestionIds).toHaveLength(3);
    expect(new Set(sel.reviewQuestionIds)).toEqual(new Set(['q0', 'q1', 'q2']));
    // Reviews + new fill the rest with no duplicates.
    expect(new Set(sel.questions.map((x) => x.id)).size).toBe(sel.questions.length);
    const news = sel.questions.filter((x) => sel.bucketByQuestion[x.id] === 'new');
    expect(news.every((x) => !sel.reviewQuestionIds.includes(x.id))).toBe(true);
  });

  it('caps review slots by the number of due items available', () => {
    const p = pool(10);
    const sel = selectAttemptQuestions({
      pool: p,
      sessionSize: 10,
      level: 3,
      seen: new Set(),
      dueReviews: [p[0]!], // only 1 due
      reviewFraction: 0.5, // would allow 5
      rng: rng(),
    });
    expect(sel.reviewQuestionIds).toHaveLength(1);
  });

  it('property: random pools never duplicate, stay ≤ sessionSize, draw only from the pool', () => {
    const r = seededRng(99);
    for (let trial = 0; trial < 100; trial++) {
      const n = 1 + Math.floor(r() * 40);
      const p = pool(n);
      const ids = new Set(p.map((x) => x.id));
      const sessionSize = 1 + Math.floor(r() * 25);
      const level = 1 + Math.floor(r() * 5);
      // Randomly mark ~half seen.
      const seen = new Set(p.filter(() => r() < 0.5).map((x) => x.id));
      const sel = selectAttemptQuestions({ pool: p, sessionSize, level, seen, rng: () => r() });
      expect(sel.questions.length).toBeLessThanOrEqual(Math.min(sessionSize, n));
      expect(sel.questions.length).toBeGreaterThanOrEqual(1);
      const got = sel.questions.map((x) => x.id);
      expect(new Set(got).size).toBe(got.length); // no duplicates
      expect(got.every((id) => ids.has(id))).toBe(true); // only from pool
    }
  });
});
