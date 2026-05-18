import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Friendly inline banner that surfaces when the browser reports `offline`.
 * Listens to `online` / `offline` events on `window` — these fire reliably
 * across desktop + mobile when network connectivity drops.
 *
 * Intentionally scoped: full offline gameplay is out of v1, so this is just
 * a "heads-up, things may break" affordance, not a full offline UX.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false;
    return navigator.onLine === false;
  });

  useEffect(() => {
    function onOnline() {
      setOffline(false);
    }
    function onOffline() {
      setOffline(true);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      {t('pwa.offline')}
    </div>
  );
}
