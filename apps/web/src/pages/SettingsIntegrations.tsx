import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GoogleCalendarSummary } from '@tutor-app/shared';
import { Bidi } from '../components/Bidi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Toast } from '../components/Toast';
import { ApiError, api } from '../lib/api';
import { useGoogleCalendars, useIntegrationStatus } from '../lib/integrations';

/**
 * /settings/integrations
 *
 * Lifecycle:
 *  - Not connected → "Connect Google Calendar" button.
 *  - Connected → list of calendars (checkboxes), Save selection, Disconnect.
 *
 * Banner: appears when the status endpoint reports `connected: false` after
 * the page was previously known to be connected (token invalidated server-
 * side mid-session).
 *
 * Error handling: typed { error: 'quota_exceeded' | ... } responses from
 * /calendars are surfaced inline; they never throw or look like crashes.
 */
export function SettingsIntegrationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const status = useIntegrationStatus();
  const connected = !!status.data?.connected;

  // Remember if we ever observed a connected state in this browser session.
  // Backed by sessionStorage so navigating away + back still shows the
  // reconnect banner if a mid-session disconnect happened (see spec:
  // "after a known-connected state").
  const [wasConnected, setWasConnected] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem('integrations.google.wasConnected') === '1';
  });
  useEffect(() => {
    if (connected) {
      setWasConnected(true);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('integrations.google.wasConnected', '1');
      }
    }
  }, [connected]);

  const calendarsQuery = useGoogleCalendars(connected);
  const [toast, setToast] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  // URL-driven banner: after Google redirects back to ?connected=1 or ?error=
  // surface a one-shot inline message and strip the params so reloads stay clean.
  const [oauthFlash] = useState<'success' | 'error' | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') return 'success';
    if (params.get('error')) return 'error';
    return null;
  });
  useEffect(() => {
    if (oauthFlash) {
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url);
    }
  }, [oauthFlash]);

  // Selection state — initialized from the server's lessonCalendarIds.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  useEffect(() => {
    if (!selectionInitialized && status.data) {
      setSelected(new Set(status.data.lessonCalendarIds));
      setSelectionInitialized(true);
    }
  }, [selectionInitialized, status.data]);

  const connectMutation = useMutation({
    mutationFn: () => api.integrationConnect(),
    onSuccess: ({ authUrl }) => {
      window.location.assign(authUrl);
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => api.integrationSetLessonCalendars({ calendarIds: Array.from(selected) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['integration', 'status'] });
      await qc.invalidateQueries({ queryKey: ['calendar'] });
      setToast(t('integrations.google.saved'));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.integrationDisconnect(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['integration', 'status'] });
      await qc.invalidateQueries({ queryKey: ['integration', 'calendars'] });
      await qc.invalidateQueries({ queryKey: ['calendar'] });
      setSelected(new Set());
      setSelectionInitialized(false);
      setDisconnectOpen(false);
      // User-initiated disconnect: clear the "was connected" flag so we
      // don't nag with a reconnect banner.
      setWasConnected(false);
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('integrations.google.wasConnected');
      }
      setToast(t('integrations.google.disconnect'));
    },
  });

  // Decide what to render for the calendars listing.
  const calendarsContent = useMemo(() => {
    if (!connected) return null;
    if (calendarsQuery.isLoading) {
      return <p className="text-sm text-ink-muted">{t('integrations.google.loadingCalendars')}</p>;
    }
    const data = calendarsQuery.data;
    if (!data) {
      return (
        <p role="alert" className="text-sm text-rose-700" data-testid="integrations-calendars-error">
          {t('integrations.google.errors.loadFailed')}
        </p>
      );
    }
    if ('error' in data) {
      const key =
        data.error === 'quota_exceeded'
          ? 'integrations.google.errors.quota'
          : data.error === 'unavailable'
            ? 'integrations.google.errors.unavailable'
            : 'integrations.google.reconnectBanner';
      return (
        <p role="alert" className="text-sm text-amber-800" data-testid="integrations-calendars-error">
          {t(key)}
        </p>
      );
    }
    return (
      <ul
        data-testid="integrations-google-calendars"
        className="mt-3 divide-y divide-line rounded border border-line bg-surface"
      >
        {data.items.map((c: GoogleCalendarSummary) => {
          const checked = selected.has(c.id);
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input
                id={`cal-${c.id}`}
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  });
                }}
                data-testid={`integrations-cal-${c.id}`}
              />
              <label htmlFor={`cal-${c.id}`} className="flex-1">
                <Bidi>{c.summary}</Bidi>
                {c.primary && (
                  <span className="ms-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-ink-muted">
                    {t('integrations.google.primaryBadge')}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    );
  }, [calendarsQuery.data, calendarsQuery.isLoading, connected, selected, t]);

  return (
    <section data-testid="integrations" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('integrations.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('integrations.subtitle')}</p>
      </header>

      {oauthFlash === 'error' && (
        <div
          role="alert"
          data-testid="integrations-oauth-error"
          className="rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          {t('integrations.google.errors.callback')}
        </div>
      )}

      {wasConnected && !connected && status.isFetched && (
        <div
          role="alert"
          data-testid="integrations-reconnect-banner"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {t('integrations.google.reconnectBanner')}
        </div>
      )}

      <section
        className="rounded-lg border border-line bg-surface p-6"
        data-testid="integrations-google"
      >
        <h2 className="text-lg font-semibold">{t('integrations.google.title')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('integrations.google.description')}</p>

        {!connected && (
          <button
            type="button"
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="mt-4 rounded bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="integrations-google-connect"
          >
            {connectMutation.isPending
              ? t('integrations.google.connecting')
              : t('integrations.google.connect')}
          </button>
        )}

        {connected && (
          <div className="mt-4 space-y-4" data-testid="integrations-google-connected">
            <p className="text-sm font-medium text-emerald-800">
              {t('integrations.google.connectedTitle')}
            </p>
            <div>
              <label className="block text-sm font-medium">
                {t('integrations.google.selectLabel')}
              </label>
              <p className="mt-1 text-xs text-ink-subtle">{t('integrations.google.selectHelp')}</p>
              {calendarsContent}
              {selected.size === 0 && status.data?.lessonCalendarIds.length === 0 && (
                <p className="mt-2 text-xs text-amber-700">{t('integrations.google.noneSelected')}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                data-testid="integrations-google-save"
              >
                {saveMutation.isPending ? t('common.workingOn') : t('integrations.google.save')}
              </button>
              <button
                type="button"
                onClick={() => setDisconnectOpen(true)}
                className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
                data-testid="integrations-google-disconnect"
              >
                {t('integrations.google.disconnect')}
              </button>
              <Link
                to="/schedule"
                className="text-sm font-medium text-ink-muted underline-offset-2 hover:underline"
              >
                {t('nav.schedule')}
              </Link>
            </div>
            {saveMutation.error instanceof ApiError && (
              <p role="alert" className="text-sm text-rose-700">
                {t('integrations.google.errors.saveFailed')}
              </p>
            )}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={disconnectOpen}
        destructive
        testId="integrations-disconnect-confirm"
        title={t('integrations.google.disconnectConfirmTitle')}
        body={<p>{t('integrations.google.disconnectConfirmBody')}</p>}
        confirmLabel={t('integrations.google.disconnect')}
        busy={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
        onCancel={() => setDisconnectOpen(false)}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="integrations-toast" />}
    </section>
  );
}
