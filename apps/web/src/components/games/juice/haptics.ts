import { prefersReducedMotion } from './reducedMotion';

/**
 * Tactile feedback via the native Vibration API. Zero dependencies.
 *
 * Reality check: `navigator.vibrate` fires on Android Chrome but is a
 * no-op on iOS Safari (Apple doesn't expose web haptics), so this is a
 * progressive enhancement — never the only signal for an event.
 *
 * Suppressed under `prefers-reduced-motion`: a buzz is motion, and a
 * student who asked for calm shouldn't get jolted.
 */
export type HapticPattern = 'light' | 'success' | 'error';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 8,
  success: [10, 30, 10],
  error: [35, 25, 35],
};

export function vibrate(pattern: HapticPattern): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some engines throw if called outside a user gesture or when the
    // device has no vibrator — treat as unsupported.
  }
}
