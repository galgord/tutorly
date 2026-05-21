import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DISMISS_KEY = 'pwa-install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Tutor-facing PWA install card. Listens for `beforeinstallprompt`, which
 * Chrome / Edge / Android fires when the app meets installability criteria
 * (manifest valid + SW active + not already installed). Safari + iOS do not
 * fire this event — users there see the standard "Add to Home Screen"
 * affordance via the share menu, no prompt needed.
 *
 * Dismissal is persisted in localStorage so a tutor who said "no" once
 * doesn't get nagged on every dashboard visit. Cleared by uninstalling +
 * reinstalling, or wiping site data.
 */
export function InstallPrompt() {
  const { t } = useTranslation();
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      // The platform suppresses the mini-infobar so we can render our own UI.
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      // App was installed (through our prompt OR via the browser's own
      // affordance). Hide the card and remember.
      setEvent(null);
      setDismissed(true);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function persistDismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // localStorage unavailable (private mode quirk) — fall through.
    }
    setDismissed(true);
  }

  async function onInstallClick() {
    if (!event) return;
    await event.prompt();
    try {
      await event.userChoice;
    } catch {
      // User-choice promise can reject if the platform tears down the
      // event — treat as a dismissal.
    }
    // The event is single-use; clear regardless of outcome.
    setEvent(null);
  }

  if (dismissed || !event) return null;

  return (
    <aside
      data-testid="pwa-install-prompt"
      className="rounded-lg border border-line bg-surface-muted p-4 text-sm shadow-sm"
      role="region"
      aria-labelledby="pwa-install-title"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 id="pwa-install-title" className="text-base font-semibold text-ink">
            {t('pwa.install.title')}
          </h2>
          <p className="mt-1 text-ink-muted">{t('pwa.install.body')}</p>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void onInstallClick()}
            data-testid="pwa-install-button"
            className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink/90"
          >
            {t('pwa.install.cta')}
          </button>
          <button
            type="button"
            onClick={persistDismiss}
            data-testid="pwa-install-dismiss"
            className="text-xs text-ink-subtle underline-offset-2 hover:underline"
          >
            {t('pwa.install.dismiss')}
          </button>
        </div>
      </div>
    </aside>
  );
}
