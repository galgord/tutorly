import { useTranslation } from 'react-i18next';
import type { StudentGameProgressResponse } from '@tutor-app/shared';
import { Bidi } from './Bidi';

/**
 * Phase 12 read-only adaptive view for the tutor: per-game current level,
 * plays, and due spaced-repetition reviews, plus the automatic top-up budget.
 * Escalation is fully automatic — there is nothing here to change.
 */
export function GameProgressPanel({
  data,
  locale,
}: {
  data: StudentGameProgressResponse;
  locale: string;
}) {
  const { t } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  if (data.games.length === 0) {
    return (
      <p data-testid="game-progress-empty" className="text-sm text-ink-muted">
        {t('progress.adaptive.empty')}
      </p>
    );
  }

  return (
    <div data-testid="game-progress-panel" className="space-y-3">
      <ul className="divide-y divide-line rounded-md border border-line">
        {data.games.map((g) => (
          <li
            key={g.gameId}
            data-testid={`game-progress-${g.gameId}`}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">
                <Bidi>{g.title}</Bidi>
              </p>
              <p className="text-xs text-ink-muted">
                {g.lastPlayedAt
                  ? t('progress.adaptive.lastPlayed', { date: dateFmt.format(new Date(g.lastPlayedAt)) })
                  : t('progress.adaptive.neverPlayed')}
                {' · '}
                {t('progress.adaptive.plays', { n: g.playsCompleted })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                data-testid={`game-progress-level-${g.gameId}`}
                className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800"
              >
                {t('progress.adaptive.level', { level: g.currentLevel })}
              </span>
              {g.dueReviewCount > 0 && (
                <span
                  data-testid={`game-progress-due-${g.gameId}`}
                  className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                >
                  {t('progress.adaptive.dueReviews', { n: g.dueReviewCount })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p data-testid="game-progress-budget" className="text-xs text-ink-muted">
        {t('progress.adaptive.budget', { used: data.budget.topUpUsed, cap: data.budget.topUpCap })}
      </p>
    </div>
  );
}
