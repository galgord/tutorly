export { useGameJuice, type GameJuice } from './useGameJuice';
export { ScorePop } from './ScorePop';
export { StreakMeter } from './StreakMeter';
export { SoundToggle } from './SoundToggle';
export {
  streakReduce,
  streakTier,
  initialStreak,
  type StreakState,
  type StreakEvent,
} from './streak';
export { usePrefersReducedMotion, prefersReducedMotion } from './reducedMotion';
export { isSoundEnabled, setSoundEnabled, unlockAudio, playSound, type SoundKind } from './sound';
export { vibrate, type HapticPattern } from './haptics';
export { fireConfetti, type ConfettiKind } from './confetti';
