import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fireConfetti } from './confetti';
import { vibrate } from './haptics';
import { usePrefersReducedMotion } from './reducedMotion';
import { isSoundEnabled, playSound, unlockAudio } from './sound';
import { initialStreak, streakReduce, type StreakState } from './streak';

export interface GameJuice {
  streak: StreakState;
  reducedMotion: boolean;
  /** Wire to the first user gesture (tap / submit) to satisfy autoplay policy. */
  unlockAudio: () => void;
  /**
   * Call AFTER `submitBufferedAnswer` resolves, passing the SERVER's
   * `correct`. The hook never decides correctness — it only reacts.
   */
  onAnswer: (opts: { correct: boolean; timedOut?: boolean }) => void;
}

/**
 * Shared "juice" for both engines: streak/combo state + sound, haptic, and
 * confetti cues. Sound is gated by reading the mute flag at call time (so the
 * standalone sound toggle in the play header stays in sync); confetti by
 * reduced-motion. Sound and motion are independent axes.
 */
export function useGameJuice(): GameJuice {
  const reducedMotion = usePrefersReducedMotion();
  const [streak, dispatch] = useReducer(streakReduce, initialStreak);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const onAnswer = useCallback(({ correct, timedOut }: { correct: boolean; timedOut?: boolean }) => {
    if (correct) {
      dispatch('correct');
      if (isSoundEnabled()) playSound('correct');
      vibrate('success');
    } else {
      dispatch(timedOut ? 'timeout' : 'wrong');
      if (isSoundEnabled()) playSound('wrong');
      vibrate('error');
    }
  }, []);

  // One-shot combo celebration when a streak crosses a tier (3 / 5 / 10).
  useEffect(() => {
    if (streak.justMilestone == null) return;
    if (isSoundEnabled()) playSound('combo');
    vibrate('light');
    if (!reducedRef.current) void fireConfetti('combo');
  }, [streak.justMilestone]);

  return { streak, reducedMotion, unlockAudio, onAnswer };
}
