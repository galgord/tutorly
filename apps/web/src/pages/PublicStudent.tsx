import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { PublicStudentDashboardResponse } from '@tutor-app/shared';
import { Bidi } from '../components/Bidi';
import { ApiError, api } from '../lib/api';

/**
 * Student dashboard. Lists ASSIGNED games (newest first) with a
 * per-game Play button + best-score / last-played badges.
 *
 * Loading / empty / 404 / error states are all explicit per the
 * cross-cutting UX spec (no white screens, no "spinner forever").
 */
export function PublicStudentPage() {
  const { t, i18n } = useTranslation();
  const params = useParams({ from: '/s/$shareToken' });
  const token = params.shareToken;
  const query = useQuery<PublicStudentDashboardResponse | null, ApiError>({
    queryKey: ['public-dashboard', token],
    queryFn: async () => {
      try {
        return await api.publicStudentDashboard(token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    retry: (failureCount, err) => err.status >= 500 && failureCount < 2,
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <p data-testid="public-student-loading" className="text-sm text-slate-600">
        {t('common.loading')}
      </p>
    );
  }

  if (query.error && query.error.status >= 500) {
    return (
      <div
        data-testid="public-student-error"
        className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center"
      >
        <h1 className="text-lg font-semibold text-rose-900">{t('publicStudent.errorTitle')}</h1>
        <p className="mt-1 text-sm text-rose-800">{t('publicStudent.errorBody')}</p>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          data-testid="public-student-retry"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div
        data-testid="public-student-not-found"
        className="rounded-lg border border-slate-200 bg-white p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('publicStudent.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('publicStudent.notFoundBody')}</p>
      </div>
    );
  }

  const games = query.data.games;
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
  });

  return (
    <section data-testid="public-student" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t('publicStudent.greeting')} <Bidi>{query.data.name}</Bidi>
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('publicStudent.subtitle')}</p>
      </header>

      {games.length === 0 ? (
        <div
          data-testid="public-student-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600"
        >
          {t('publicStudent.emptyGames')}
        </div>
      ) : (
        <ul data-testid="public-student-games" className="grid gap-3">
          {games.map((g) => {
            const lastPlayed = g.lastPlayedAt ? new Date(g.lastPlayedAt) : null;
            const typeKey = g.type === 'FILL_BLANK' ? 'typeFillBlank' : 'typeTimedQuiz';
            return (
              <li
                key={g.id}
                data-testid={`public-student-game-${g.id}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-base font-semibold">
                    <Bidi>{g.title}</Bidi>
                  </p>
                  <p className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{t(`publicStudent.${typeKey}`)}</span>
                    {g.currentLevel !== undefined && (
                      <span
                        data-testid={`public-student-level-${g.id}`}
                        className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800"
                      >
                        {t('publicStudent.level', { level: g.currentLevel })}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {lastPlayed
                      ? t('publicStudent.lastPlayedOn', { date: dateFormatter.format(lastPlayed) })
                      : t('publicStudent.neverPlayed')}
                    {g.bestScore !== null && ` · ${t('publicStudent.bestScore', { score: g.bestScore })}`}
                  </p>
                </div>
                <Link
                  to="/s/$shareToken/play/$gameId"
                  params={{ shareToken: token, gameId: g.id }}
                  data-testid={`public-student-play-${g.id}`}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  {t('publicStudent.play')}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
