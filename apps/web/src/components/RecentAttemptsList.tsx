import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AttemptHistoryResponse } from '@tutor-app/shared';
import { Bidi } from './Bidi';

interface Props {
  data: AttemptHistoryResponse;
  locale: string;
  page: number;
  onPageChange: (page: number) => void;
}

/**
 * Paginated recent attempts. Each row expands to show per-question results
 * inline (the api already ships them on the item — no extra request).
 *
 * Monthly aggregates of pre-cutoff attempts are surfaced at the bottom so
 * the tutor sees "you played a lot in November" without paging into deep
 * history.
 */
export function RecentAttemptsList({ data, locale, page, onPageChange }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const dateFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const totalPages = Math.max(1, Math.ceil(data.totalRecent / data.limit));

  if (data.items.length === 0 && data.monthlyAggregates.length === 0) {
    return (
      <div
        data-testid="attempts-empty"
        className="rounded border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600"
      >
        {t('progress.attempts.empty')}
      </div>
    );
  }

  return (
    <div data-testid="attempts-list" className="space-y-3">
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {data.items.map((a) => {
          const isOpen = expanded.has(a.id);
          const pct =
            a.accuracy === null ? '—' : `${Math.round(a.accuracy * 100)}%`;
          return (
            <li
              key={a.id}
              data-testid={`attempt-row-${a.id}`}
              className="px-4 py-3 text-sm"
            >
              <button
                type="button"
                onClick={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(a.id)) next.delete(a.id);
                    else next.add(a.id);
                    return next;
                  });
                }}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 text-start"
                data-testid={`attempt-toggle-${a.id}`}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <Bidi>{a.gameTitle}</Bidi>
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateFmt.format(new Date(a.startedAt))} ·{' '}
                    {t(`progress.attempts.type_${a.gameType}`)}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="font-semibold">{pct}</p>
                  <p className="text-xs text-slate-500">
                    {t('progress.attempts.correctOf', {
                      correct: a.correctCount,
                      total: a.questionsAnswered,
                    })}
                  </p>
                </div>
              </button>

              {isOpen && (
                <ul
                  data-testid={`attempt-detail-${a.id}`}
                  className="mt-3 space-y-1 border-s-2 border-slate-200 ps-3 text-xs"
                >
                  {a.results.length === 0 ? (
                    <li className="text-slate-500">{t('progress.attempts.noAnswers')}</li>
                  ) : (
                    a.results.map((r) => (
                      <li
                        key={r.questionId}
                        className={`rounded px-2 py-1 ${r.correct ? 'bg-green-50' : 'bg-rose-50'}`}
                      >
                        <p className="font-medium">
                          <Bidi>{r.prompt}</Bidi>
                        </p>
                        <p className="text-slate-700">
                          <span>{t('progress.attempts.studentAnswer')}: </span>
                          <Bidi>{r.rawAnswer || '—'}</Bidi>
                          {!r.correct && (
                            <>
                              {' · '}
                              <span>{t('progress.attempts.expected')}: </span>
                              <Bidi>{r.expectedAnswer}</Bidi>
                            </>
                          )}
                          {r.timedOut && (
                            <>
                              {' · '}
                              <span className="text-rose-700">
                                {t('progress.attempts.timedOut')}
                              </span>
                            </>
                          )}
                        </p>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div
          data-testid="attempts-pagination"
          className="flex items-center justify-between gap-2 text-xs"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            data-testid="attempts-prev"
          >
            {/* Directional arrow — flipped automatically in RTL via the
                global `.icon-flip` rule in styles.css. */}
            <span aria-hidden="true" className="icon-flip" data-testid="attempts-prev-arrow">
              ←
            </span>
            {t('progress.attempts.prev')}
          </button>
          <span className="text-slate-600">
            {t('progress.attempts.pageOf', { page, total: totalPages })}
          </span>
          <button
            type="button"
            disabled={!data.hasMore}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            data-testid="attempts-next"
          >
            {t('progress.attempts.next')}
            <span aria-hidden="true" className="icon-flip" data-testid="attempts-next-arrow">
              →
            </span>
          </button>
        </div>
      )}

      {/* Monthly aggregates for pre-cutoff history */}
      {data.monthlyAggregates.length > 0 && (
        <div data-testid="attempts-monthly" className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('progress.attempts.olderHistory')}
          </h4>
          <ul className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
            {data.monthlyAggregates.map((m) => (
              <li
                key={m.month}
                data-testid={`attempts-month-${m.month}`}
                className="flex justify-between gap-2"
              >
                <span>{m.month}</span>
                <span className="text-slate-500">
                  {t('progress.attempts.monthlySummary', {
                    count: m.attemptCount,
                    avg: m.avgAccuracy === null ? '—' : `${Math.round(m.avgAccuracy * 100)}%`,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
