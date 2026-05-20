import { DEFAULT_DIFFICULTY, type GameQuestion } from '@tutor-app/shared';
import { sampleQuestions } from './question-sampler';

/**
 * Phase 12 adaptive question selection. Replaces the flat per-attempt shuffle
 * with a blend that delivers (a) non-repetition across plays and (b) questions
 * targeted at the student's current cross-play difficulty level.
 *
 * Three buckets, drawn disjoint (a final id Set guarantees no duplicates):
 *   1. review  — due spaced-repetition items (Phase 12C/D; empty here when
 *                reviewFraction is 0 / no due items supplied).
 *   2. new     — UNSEEN questions in a difficulty band around `level`, widening
 *                level → ±1 → ±2 … until the session is filled.
 *   3. recycle — only if the unseen pool is drained: SEEN questions, banded
 *                around level (12D orders these by past accuracy/recency).
 *
 * Difficulty is frozen for the whole play (cross-play escalation only). The
 * within-band shuffle delegates to the pure, property-tested `sampleQuestions`.
 */

export type SelectionBucket = 'review' | 'new' | 'recycle';

export interface AdaptiveSelectInput {
  pool: readonly GameQuestion[];
  sessionSize: number;
  /** Current cross-play difficulty level (1..5). */
  level: number;
  /** Question ids the student has already answered (non-repetition set). */
  seen: ReadonlySet<string>;
  /** Due-for-review questions, already ordered by due date. Phase 12C/D. */
  dueReviews?: readonly GameQuestion[];
  /** Fraction of the session reserved for reviews. 0 until Phase 12C/D. */
  reviewFraction?: number;
  /** Lower rank = pick first when recycling seen questions (Phase 12D). */
  recycleRank?: (id: string) => number;
  /** Injectable RNG for deterministic tests; defaults to crypto via sampleQuestions. */
  rng?: () => number;
}

export interface AdaptiveSelection {
  questions: GameQuestion[];
  bucketByQuestion: Record<string, SelectionBucket>;
  reviewQuestionIds: string[];
}

/** Order questions by |difficulty - level| ascending; shuffle within each ring. */
function bandOrder(
  qs: readonly GameQuestion[],
  level: number,
  rng: (() => number) | undefined,
): GameQuestion[] {
  const byDist = new Map<number, GameQuestion[]>();
  for (const q of qs) {
    const dist = Math.abs((q.difficulty ?? DEFAULT_DIFFICULTY) - level);
    const ring = byDist.get(dist);
    if (ring) ring.push(q);
    else byDist.set(dist, [q]);
  }
  const out: GameQuestion[] = [];
  for (const dist of [...byDist.keys()].sort((a, b) => a - b)) {
    const ring = byDist.get(dist)!;
    out.push(...sampleQuestions({ pool: ring, sessionSize: ring.length, rng }));
  }
  return out;
}

export function selectAttemptQuestions(input: AdaptiveSelectInput): AdaptiveSelection {
  const poolSize = input.pool.length;
  const N = Math.max(0, Math.min(input.sessionSize | 0, poolSize));
  const due = input.dueReviews ?? [];
  const reviewFraction = input.reviewFraction ?? 0;

  const picked: GameQuestion[] = [];
  const ids = new Set<string>();
  const bucketByQuestion: Record<string, SelectionBucket> = {};
  const reviewQuestionIds: string[] = [];

  const take = (q: GameQuestion, bucket: SelectionBucket): void => {
    if (picked.length >= N || ids.has(q.id)) return;
    ids.add(q.id);
    picked.push(q);
    bucketByQuestion[q.id] = bucket;
    if (bucket === 'review') reviewQuestionIds.push(q.id);
  };

  // 1. Review slots (oldest-due first).
  const reviewSlots = Math.min(due.length, Math.round(N * reviewFraction));
  for (const q of due) {
    if (reviewQuestionIds.length >= reviewSlots) break;
    take(q, 'review');
  }

  // 2. New target-difficulty slots from the unseen pool.
  const unseen = input.pool.filter((q) => !input.seen.has(q.id) && !ids.has(q.id));
  for (const q of bandOrder(unseen, input.level, input.rng)) {
    if (picked.length >= N) break;
    take(q, 'new');
  }

  // 3. Recycle seen questions only if still short (drained game).
  if (picked.length < N) {
    const seenQs = input.pool.filter((q) => input.seen.has(q.id) && !ids.has(q.id));
    const ordered = input.recycleRank
      ? [...seenQs].sort((a, b) => input.recycleRank!(a.id) - input.recycleRank!(b.id))
      : bandOrder(seenQs, input.level, input.rng);
    for (const q of ordered) {
      if (picked.length >= N) break;
      take(q, 'recycle');
    }
  }

  return { questions: picked, bucketByQuestion, reviewQuestionIds };
}
