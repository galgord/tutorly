import { useEffect, useState } from 'react';

/**
 * Returns `value` delayed by `delayMs` — the returned value only updates once
 * `value` has stopped changing for the delay window. Used to throttle
 * search-as-you-type so a network query doesn't fire on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
