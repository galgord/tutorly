import { GameType } from '@prisma/client';
import { type GameQuestion } from '@tutor-app/shared';
import { type SelectionBucket } from './adaptive-selector';

/**
 * Phase 12D last-resort freshness for RECYCLED (already-seen) questions, used
 * only when the unseen pool is drained. Conservative + pure:
 *  - TIMED_QUIZ: swap in distractors drawn from same-topic sibling questions so
 *    the wrong options differ from last time. Keeps the base id + answer (so
 *    seen-tracking + spaced-repetition stay coherent) and only varies the
 *    surface. Falls back to the original distractors when there aren't enough
 *    safe siblings.
 *  - FILL_BLANK: returned unchanged — there's no safe surface rewrite without
 *    an LLM; real freshness for drained fill-blank pools comes from the
 *    Phase 12E background top-up.
 * Non-recycle questions pass through untouched.
 */
export function freshenRecycled(opts: {
  questions: GameQuestion[];
  bucketByQuestion: Record<string, SelectionBucket>;
  pool: readonly GameQuestion[];
  gameType: GameType;
  rng?: () => number;
}): GameQuestion[] {
  if (opts.gameType !== GameType.TIMED_QUIZ) return opts.questions;
  const rng = opts.rng ?? Math.random;
  return opts.questions.map((q) => {
    if (opts.bucketByQuestion[q.id] !== 'recycle') return q;
    const swapped = siblingDistractors(q, opts.pool, rng);
    return swapped ? { ...q, distractors: swapped } : q;
  });
}

function siblingDistractors(
  q: GameQuestion,
  pool: readonly GameQuestion[],
  rng: () => number,
): string[] | null {
  const tags = new Set(q.topicTags);
  const answerNorm = q.answer.trim().toLowerCase();
  const seen = new Set<string>([answerNorm]);
  const candidates: string[] = [];
  for (const other of pool) {
    if (other.id === q.id) continue;
    if (!other.topicTags.some((t) => tags.has(t))) continue; // same-topic only
    const cand = other.answer.trim();
    const norm = cand.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    candidates.push(cand);
  }
  if (candidates.length < 3) return null; // not enough safe siblings — keep original
  // Fisher-Yates the first 3 slots.
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng() * (candidates.length - i));
    const tmp = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = tmp;
  }
  return candidates.slice(0, 3);
}
