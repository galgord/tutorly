import { MAX_DIFFICULTY, MIN_DIFFICULTY } from '@tutor-app/shared';

/**
 * Phase 12 cross-play difficulty policy (pure). Difficulty escalates BETWEEN
 * plays, never mid-session. After a finished play we look at the student's
 * accuracy over the session's NON-REVIEW questions and decide the next level.
 *
 * Rules (all thresholds env-tunable):
 *  - Too little signal (< minSample answered) → hold, don't touch the nudge counter.
 *  - acc ≥ advanceThreshold → advance one level.
 *  - holdFloor ≤ acc < advanceThreshold → a "competent hold": tick the nudge
 *    counter; after nudgeEveryN consecutive holds, nudge up one level anyway so
 *    a plateauing-but-capable student keeps progressing.
 *  - acc < holdFloor → a struggling play: reset the nudge counter and hold
 *    (or step down only if allowDown is enabled). NEVER auto-advance.
 */

export const MIN_LEVEL = MIN_DIFFICULTY;
export const MAX_LEVEL = MAX_DIFFICULTY;

export interface LevelPolicyConfig {
  advanceThreshold: number;
  holdFloor: number;
  nudgeEveryN: number;
  minSample: number;
  allowDown: boolean;
}

export interface LevelState {
  level: number;
  nudgeCounter: number;
}

export interface LevelOutcome {
  /** New level after clamping into [1,5]. */
  level: number;
  /** Updated consecutive-competent-hold counter. */
  nudgeCounter: number;
  /** Actual change applied (newLevel - oldLevel); 0 when clamped at a bound. */
  delta: number;
}

function clampLevel(n: number): number {
  if (n < MIN_LEVEL) return MIN_LEVEL;
  if (n > MAX_LEVEL) return MAX_LEVEL;
  return n;
}

export function computeLevelOutcome(opts: {
  state: LevelState;
  correctNonReview: number;
  answeredNonReview: number;
  config: LevelPolicyConfig;
}): LevelOutcome {
  const { level, nudgeCounter } = opts.state;
  const { advanceThreshold, holdFloor, nudgeEveryN, minSample, allowDown } = opts.config;

  // Not enough signal to move the level — and don't let a tiny sample tick the
  // anti-stall counter either.
  if (opts.answeredNonReview < minSample) {
    return { level, nudgeCounter, delta: 0 };
  }

  const acc = opts.correctNonReview / opts.answeredNonReview;
  let intendedDelta = 0;
  let nextNudge = nudgeCounter;

  if (acc >= advanceThreshold) {
    intendedDelta = 1;
    nextNudge = 0;
  } else if (acc >= holdFloor) {
    // Competent hold — accrue toward an anti-stall nudge.
    nextNudge = nudgeCounter + 1;
    if (nextNudge >= nudgeEveryN) {
      intendedDelta = 1;
      nextNudge = 0;
    }
  } else {
    // Struggling — never auto-advance; reset the nudge accrual.
    nextNudge = 0;
    intendedDelta = allowDown ? -1 : 0;
  }

  const newLevel = clampLevel(level + intendedDelta);
  return { level: newLevel, nudgeCounter: nextNudge, delta: newLevel - level };
}
