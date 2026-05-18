/**
 * Service-worker registration entry. Kept in its own module so we can
 * register lazily after the app shell paints (so the SW install doesn't
 * compete with the initial render).
 *
 * `virtual:pwa-register` is a Vite-time-only module emitted by
 * `vite-plugin-pwa`. We import it dynamically so the bundle still resolves
 * cleanly in unit-test environments where the plugin isn't active.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    const mod = (await import(
      /* @vite-ignore */ 'virtual:pwa-register'
    )) as { registerSW?: (opts: { immediate?: boolean }) => void };
    mod.registerSW?.({ immediate: true });
  } catch {
    // Virtual module unavailable (e.g. running under Vitest) — silent.
  }
}
