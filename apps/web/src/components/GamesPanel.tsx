import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameResponse, QuotaExceededResponse } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { useLessonGames } from '../lib/games';
import { Bidi } from './Bidi';
import { GamePreviewDialog } from './GamePreviewDialog';
import { QuestionReviewModal } from './QuestionReviewModal';
import { Toast } from './Toast';

interface Props {
  lessonId: string;
  /** True when the lesson has feedback worth generating from. */
  canGenerate: boolean;
  /** Dirty-state hint — disables generation while the editor has unsaved edits. */
  hasUnsavedFeedback: boolean;
}

/**
 * The lesson detail page's games section. Lists existing games with their
 * status badges and exposes the two generate-buttons. Clicking a card
 * opens the question review modal.
 */
export function GamesPanel({ lessonId, canGenerate, hasUnsavedFeedback }: Props) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const games = useLessonGames(lessonId);
  const me = useMe();
  const [reviewGameId, setReviewGameId] = useState<string | null>(null);
  const [previewGameId, setPreviewGameId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Persistent banner state when the tutor hits their monthly cap. Stays
  // until the next successful create or until the page is reloaded —
  // a one-shot toast disappears too fast for context this important.
  const [quotaError, setQuotaError] = useState<QuotaExceededResponse | null>(null);

  const createMutation = useMutation<GameResponse, ApiError, 'FILL_BLANK' | 'TIMED_QUIZ'>({
    mutationFn: (type) => api.createGame(lessonId, { type, poolSize: 30 }),
    onSuccess: async (game) => {
      setQuotaError(null);
      await qc.invalidateQueries({ queryKey: ['lesson-games', lessonId] });
      setReviewGameId(game.id);
    },
    onError: (err) => {
      if (err.status === 429 && isQuotaError(err.body)) {
        setQuotaError(err.body);
      } else if (err.status === 400) {
        setToast(t('games.toast.noFeedback'));
      } else {
        setToast(t('games.toast.createFailed'));
      }
    },
  });

  const overCap = !!quotaError;

  const quota = me.data
    ? {
        used: me.data.monthlyGenerations,
        cap: me.data.monthlyGenerationsCap,
      }
    : null;
  const quotaWarning = !!quota && quota.used >= quota.cap;

  const deleteMutation = useMutation<void, ApiError, string>({
    mutationFn: (id) => api.deleteGame(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['lesson-games', lessonId] });
      setToast(t('games.toast.deleted'));
    },
  });

  return (
    <section data-testid="games-panel" className="rounded-lg border border-line bg-surface p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('games.title')}</h2>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => createMutation.mutate('FILL_BLANK')}
              disabled={!canGenerate || hasUnsavedFeedback || overCap || createMutation.isPending}
              className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              data-testid="games-generate-fill-blank"
            >
              {createMutation.isPending ? t('common.workingOn') : t('games.generateFillBlank')}
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate('TIMED_QUIZ')}
              disabled={!canGenerate || hasUnsavedFeedback || overCap || createMutation.isPending}
              className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              data-testid="games-generate-timed-quiz"
            >
              {createMutation.isPending ? t('common.workingOn') : t('games.generateTimedQuiz')}
            </button>
          </div>
          {quota && (
            <p
              data-testid="games-quota-meter"
              className={`text-xs ${quotaWarning ? 'font-medium text-amber-700' : 'text-ink-subtle'}`}
            >
              {t('games.quotaMeter', { used: quota.used, cap: quota.cap })}
            </p>
          )}
        </div>
      </header>

      <ul className="mt-2 space-y-0.5 text-xs text-ink-subtle" data-testid="games-type-descriptions">
        <li>{t('games.generateFillBlankDesc')}</li>
        <li>{t('games.generateTimedQuizDesc')}</li>
      </ul>

      {!canGenerate && (
        <p className="mt-3 text-sm text-ink-muted" data-testid="games-need-feedback">
          {t('games.needFeedback')}
        </p>
      )}

      {canGenerate && hasUnsavedFeedback && (
        <p className="mt-3 text-sm text-amber-700" data-testid="games-feedback-dirty">
          {t('games.saveFirst')}
        </p>
      )}

      {quotaError && (
        <div
          role="alert"
          data-testid="games-quota-banner"
          className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <p className="font-medium">{t('games.quotaBanner.title')}</p>
          <p className="mt-1">
            {t('games.quotaBanner.body', {
              used: quotaError.used,
              cap: quotaError.cap,
              date: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
                dateStyle: 'long',
              }).format(new Date(quotaError.resetsAt)),
            })}
          </p>
        </div>
      )}

      {games.isLoading && (
        <p className="mt-4 text-sm text-ink-muted">{t('common.loading')}</p>
      )}

      {games.data && games.data.items.length === 0 && (
        <p
          data-testid="games-empty"
          className="mt-4 rounded border border-dashed border-line bg-surface-muted px-3 py-4 text-center text-sm text-ink-muted"
        >
          {t('games.empty')}
        </p>
      )}

      {games.data && games.data.items.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded border border-line">
          {games.data.items.map((g) => (
            <li
              key={g.id}
              data-testid={`games-row-${g.id}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <Bidi>{g.title}</Bidi>{' '}
                  <span
                    data-testid={`games-status-${g.id}`}
                    className={`ms-2 rounded px-1.5 py-0.5 text-xs ${statusBadgeClass(g.status)}`}
                  >
                    {t(`games.status.${g.status}`)}
                  </span>
                </p>
                <p className="text-xs text-ink-subtle">
                  {g.type === 'FILL_BLANK' ? t('games.typeFillBlank') : t('games.typeTimedQuiz')}
                  {g.questionPool.length > 0 && (
                    <> · {t('games.questionCount', { count: g.questionPool.length })}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setReviewGameId(g.id)}
                  className="rounded border border-line-strong px-2 py-1 text-xs hover:bg-surface-muted"
                  data-testid={`games-open-${g.id}`}
                >
                  {g.status === 'DRAFT' || g.status === 'FAILED' || g.status === 'GENERATING'
                    ? t('games.review')
                    : t('games.view')}
                </button>
                {g.questionPool.length > 0 && g.status !== 'FAILED' && (
                  <button
                    type="button"
                    onClick={() => setPreviewGameId(g.id)}
                    className="rounded border border-line bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                    data-testid={`games-preview-${g.id}`}
                  >
                    {t('games.preview')}
                  </button>
                )}
                {g.status !== 'ARCHIVED' && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(g.id)}
                    disabled={deleteMutation.isPending}
                    className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                    data-testid={`games-delete-${g.id}`}
                  >
                    {t('games.delete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {reviewGameId && (
        <QuestionReviewModal
          open={!!reviewGameId}
          gameId={reviewGameId}
          onClose={() => setReviewGameId(null)}
        />
      )}

      <GamePreviewDialog gameId={previewGameId} onClose={() => setPreviewGameId(null)} />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="games-toast" />}
    </section>
  );
}

function isQuotaError(body: unknown): body is QuotaExceededResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    (body as { error: unknown }).error === 'quota_exceeded'
  );
}

function statusBadgeClass(status: GameResponse['status']): string {
  switch (status) {
    case 'GENERATING':
      return 'bg-amber-100 text-amber-900';
    case 'DRAFT':
      return 'bg-surface-sunken text-ink';
    case 'FAILED':
      return 'bg-rose-100 text-rose-900';
    case 'ASSIGNED':
      return 'bg-emerald-100 text-emerald-900';
    case 'ARCHIVED':
      return 'bg-surface-sunken text-ink-muted';
    default:
      return 'bg-surface-sunken text-ink-muted';
  }
}
