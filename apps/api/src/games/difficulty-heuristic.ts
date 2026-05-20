import {
  DEFAULT_DIFFICULTY,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  type GameQuestion,
} from '@tutor-app/shared';

/**
 * Phase 12 difficulty backfill. Existing games (generated before difficulty
 * tagging existed) read as a flat "medium" pool via the schema default, which
 * gives the adaptive engine no spread to escalate through. This pure module
 * derives a 1–5 difficulty per question from cheap surface features and assigns
 * it by within-pool percentile, so any pool of ≥5 questions spans the full
 * range. It is NOT used for freshly-generated pools — those carry the LLM's own
 * difficulty rating.
 *
 * Everything here is pure + deterministic so the backfill sweep is idempotent:
 * re-running on an already-spread pool reproduces the same spread.
 */

/** Cheap "raw hardness" from surface features. Higher = harder. */
export function hardnessScore(q: GameQuestion): number {
  const answer = q.answer.trim();
  const answerLen = answer.length;
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const promptLen = q.prompt.trim().length;
  const distractorCount = q.distractors.length;
  // Weights are arbitrary-but-stable: multi-word answers dominate, then raw
  // answer length, then prompt length, then choice load.
  return answerLen * 1 + wordCount * 4 + promptLen * 0.2 + distractorCount * 1.5;
}

/**
 * Assign a 1..5 difficulty to each question by its rank within the pool.
 * Returns a NEW array in the original order; every other field is preserved.
 * Ties break by original index so the result is fully deterministic.
 */
export function assignHeuristicDifficulty(pool: GameQuestion[]): GameQuestion[] {
  const n = pool.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...pool[0]!, difficulty: DEFAULT_DIFFICULTY }];

  const ranked = pool
    .map((q, i) => ({ i, score: hardnessScore(q) }))
    .sort((a, b) => a.score - b.score || a.i - b.i);

  const difficultyByIndex = new Array<number>(n);
  ranked.forEach((entry, rank) => {
    // Even split of ranks 0..n-1 across buckets 1..5.
    const bucket = Math.floor((rank * MAX_DIFFICULTY) / n) + MIN_DIFFICULTY;
    difficultyByIndex[entry.i] = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, bucket));
  });

  return pool.map((q, i) => ({ ...q, difficulty: difficultyByIndex[i]! }));
}

/**
 * True when a pool looks "unrated" — every question sits at the default tier.
 * A pre-Phase-12 pool (no difficulty key) parses as all-default and matches;
 * a heuristic- or LLM-rated pool spans tiers and does not. Lets the backfill
 * sweep skip already-rated pools so repeat boots stay cheap.
 */
export function isUnratedPool(pool: GameQuestion[]): boolean {
  if (pool.length === 0) return false;
  return pool.every((q) => q.difficulty === DEFAULT_DIFFICULTY);
}
