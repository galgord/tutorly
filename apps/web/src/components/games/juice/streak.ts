/**
 * Pure streak/combo state machine. No I/O, no React — just a reducer so
 * it's trivially unit-testable and can't drift from the UI.
 *
 * IMPORTANT: a streak is *cosmetic flair only*. It never contributes to
 * the score — the server is the sole authority on points. We track
 * consecutive-correct count to drive a flame meter and milestone
 * celebrations, nothing more.
 */
export interface StreakState {
  /** Consecutive correct answers right now. */
  current: number;
  /** Best streak reached this session (for end-of-game flavor). */
  best: number;
  /**
   * The streak value if this event just crossed into a new tier
   * (3 / 5 / 10), else null. Drives the one-shot combo cue + confetti.
   */
  justMilestone: number | null;
}

export type StreakEvent = 'correct' | 'wrong' | 'timeout' | 'reset';

export const initialStreak: StreakState = { current: 0, best: 0, justMilestone: null };

/** Cosmetic tiers: 0 none, 1 (3–4), 2 (5–9), 3 (10+). */
export function streakTier(current: number): 0 | 1 | 2 | 3 {
  if (current >= 10) return 3;
  if (current >= 5) return 2;
  if (current >= 3) return 1;
  return 0;
}

export function streakReduce(state: StreakState, event: StreakEvent): StreakState {
  switch (event) {
    case 'correct': {
      const current = state.current + 1;
      const crossedUp = streakTier(current) > streakTier(state.current);
      return {
        current,
        best: Math.max(state.best, current),
        justMilestone: crossedUp ? current : null,
      };
    }
    case 'wrong':
    case 'timeout':
      // Break the streak; keep the session best.
      return { current: 0, best: state.best, justMilestone: null };
    case 'reset':
      return { ...initialStreak };
    default:
      return state;
  }
}
