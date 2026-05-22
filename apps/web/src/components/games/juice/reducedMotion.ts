import { useEffect, useState } from 'react';

/**
 * `prefers-reduced-motion` support for the game "juice" layer.
 *
 * Reduced motion is our calm-mode switch: when set, engines render the
 * deterministic static layout (no rising bubbles, no particles, no
 * count-up) and effects collapse to instant opacity changes. This is
 * also the layout the Playwright suite exercises, so the animated path
 * can never regress core play.
 *
 * Guards `matchMedia` because jsdom (unit tests) and SSR don't implement
 * it — absence is treated as "no preference" (motion allowed).
 */
const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    // Safari < 14 only has the deprecated addListener/removeListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}
