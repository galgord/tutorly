import { useTranslation } from 'react-i18next';
import type { StudentProgressResponse } from '@tutor-app/shared';
import { Bidi } from './Bidi';
import { Sparkline } from './Sparkline';
import { TopicMasteryChart } from './TopicMasteryChart';

interface Props {
  data: StudentProgressResponse;
  rtl: boolean;
  locale: string;
  /** When false, the per-game cards are hidden — the student page shows its
   *  own "Practice games" grid, so rendering them here would duplicate. */
  showGames?: boolean;
}

const TREND_COPY = {
  improving: { tone: 'improving', key: 'trendImproving' },
  declining: { tone: 'declining', key: 'trendDeclining' },
  stable: { tone: 'stable', key: 'trendStable' },
  insufficient: { tone: 'insufficient', key: 'trendInsufficient' },
} as const;

const TREND_BADGE: Record<keyof typeof TREND_COPY, string> = {
  improving: 'bg-green-50 text-green-800 border-green-200',
  declining: 'bg-rose-50 text-rose-800 border-rose-200',
  stable: 'bg-surface-muted text-ink-muted border-line',
  insufficient: 'bg-surface-muted text-ink-subtle border-line',
};

export function ProgressOverview({ data, rtl, locale, showGames = true }: Props) {
  const { t } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const pct = (n: number | null): string =>
    n === null
      ? t('progress.notEnoughData')
      : `${Math.round(n * 100)}%`;

  return (
    <section data-testid="progress-overview" className="space-y-6">
      {/* Totals strip */}
      <div
        data-testid="progress-totals"
        className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4"
      >
        <Totals
          label={t('progress.totals.completedAttempts')}
          value={String(data.totals.completedAttempts)}
        />
        <Totals
          label={t('progress.totals.questionsAnswered')}
          value={String(data.totals.totalQuestionsAnswered)}
        />
        <Totals
          label={t('progress.totals.overallAccuracy')}
          value={pct(data.totals.overallAccuracy)}
        />
        <Totals
          label={t('progress.totals.lastActive')}
          value={
            data.totals.lastAttemptAt
              ? dateFmt.format(new Date(data.totals.lastAttemptAt))
              : t('progress.never')
          }
        />
      </div>

      {/* Game cards — hidden on the student page, which has its own grid. */}
      {showGames && (
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('progress.games.title')}
        </h3>
        {data.games.length === 0 ? (
          <div
            data-testid="progress-games-empty"
            className="mt-2 rounded border border-dashed border-line bg-surface-muted p-4 text-center text-sm text-ink-muted"
          >
            {t('progress.games.empty')}
          </div>
        ) : (
          <ul
            data-testid="progress-games-list"
            className="mt-2 grid gap-3 sm:grid-cols-2"
          >
            {data.games.map((g) => {
              const meta = TREND_COPY[g.trend];
              return (
                <li
                  key={g.id}
                  data-testid={`progress-game-${g.id}`}
                  className="rounded-lg border border-line bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        <Bidi>{g.title}</Bidi>
                      </p>
                      <p className="text-xs text-ink-subtle">
                        {t(`progress.games.type_${g.type}`)}
                      </p>
                    </div>
                    <span
                      data-testid={`progress-game-trend-${g.id}`}
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${TREND_BADGE[g.trend]}`}
                    >
                      {t(`progress.games.${meta.key}`)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="text-xs text-ink-muted">
                      <p>
                        <span className="font-medium">{t('progress.games.latest')}: </span>
                        {pct(g.latestAccuracy)}
                      </p>
                      <p>
                        <span className="font-medium">{t('progress.games.best')}: </span>
                        {pct(g.bestAccuracy)}
                      </p>
                      <p>
                        <span className="font-medium">{t('progress.games.attempts')}: </span>
                        {g.attemptCount}
                      </p>
                    </div>
                    <Sparkline
                      points={g.sparkline.map((p) => ({ accuracy: p.accuracy }))}
                      rtl={rtl}
                      tone={meta.tone}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {/* Topic mastery chart */}
      <div data-testid="progress-topics">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('progress.topics.title')}
        </h3>
        <div className="mt-2 rounded-lg border border-line bg-surface p-4">
          <TopicMasteryChart topics={data.topics} rtl={rtl} />
        </div>
      </div>

      {/* Hardest questions */}
      {data.hardestQuestions.length > 0 && (
        <div data-testid="progress-hardest">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('progress.hardest.title')}
          </h3>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {data.hardestQuestions.map((q) => (
              <li
                key={q.questionId}
                data-testid={`progress-hardest-${q.questionId}`}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">
                    <Bidi>{q.prompt}</Bidi>
                  </p>
                  {q.topicTags.length > 0 && (
                    <p className="text-xs text-ink-subtle">
                      {q.topicTags.join(' · ')}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-800">
                  {pct(q.accuracy)} · {q.correctCount}/{q.seenCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
