/**
 * Phase 12C spaced repetition — a 5-box Leitner schedule (pure).
 *
 * A correct answer promotes the question one box (longer interval before it's
 * due again); a wrong answer drops it back to box 1 (due almost immediately).
 * Intervals are configured in days, indexed by box-1 (env SR_BOX_INTERVALS_DAYS,
 * default [0,1,3,7,16]). Chosen over full SM-2 because fixed-interval Leitner is
 * trivially deterministic and property-testable.
 */

export const MIN_BOX = 1;
export const MAX_BOX = 5;
export const DEFAULT_SR_INTERVALS_DAYS = [0, 1, 3, 7, 16];

export interface LeitnerOutcome {
  box: number;
  intervalDays: number;
}

/**
 * Next box + interval given the prior box and the latest result. A brand-new
 * question should pass `box: 1` (its conceptual starting box): correct → box 2,
 * wrong → box 1 (due next session, so the loop closes).
 */
export function nextReview(opts: {
  box: number;
  correct: boolean;
  intervals: number[];
}): LeitnerOutcome {
  const prior = Math.min(MAX_BOX, Math.max(MIN_BOX, Math.trunc(opts.box) || MIN_BOX));
  const box = opts.correct ? Math.min(MAX_BOX, prior + 1) : MIN_BOX;
  const intervals = opts.intervals.length > 0 ? opts.intervals : DEFAULT_SR_INTERVALS_DAYS;
  // intervals are 1-indexed by box; clamp into the array.
  const idx = Math.min(intervals.length - 1, box - 1);
  const intervalDays = intervals[idx] ?? 0;
  return { box, intervalDays };
}

/** Absolute due date for an interval in days from `now`. */
export function dueDate(now: Date, intervalDays: number): Date {
  return new Date(now.getTime() + Math.max(0, intervalDays) * 24 * 60 * 60 * 1000);
}
