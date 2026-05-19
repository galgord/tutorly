import type { StudentSummary } from '@tutor-app/shared';
import { Clock, Gamepad2, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface StudentIndicatorsProps {
  summary: StudentSummary;
  /** When true, indicators stack tightly for a card layout. Default = inline. */
  compact?: boolean;
}

/**
 * Mastery % · last activity · games-assigned. Used on student rows + cards.
 * When the student has never played, the caller is expected to render an
 * invite-link affordance instead of these chips (see `wasEverActive`).
 */
export function StudentIndicators({ summary, compact = false }: StudentIndicatorsProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';

  const accuracyPct =
    summary.overallAccuracy === null ? null : Math.round(summary.overallAccuracy * 100);
  const lastActivityLabel = summary.lastAttemptAt
    ? formatRelative(summary.lastAttemptAt, locale)
    : null;

  return (
    <ul
      className={[
        'flex items-center gap-x-4 gap-y-1 text-xs text-ink-muted',
        compact ? 'flex-wrap' : '',
      ].join(' ')}
    >
      <Chip Icon={Target}>
        {accuracyPct === null
          ? t('students.indicators.masteryEmpty')
          : t('students.indicators.mastery', { pct: accuracyPct })}
      </Chip>
      <Chip Icon={Gamepad2}>
        {t('students.indicators.games', { count: summary.assignedGamesCount })}
      </Chip>
      <Chip Icon={Clock}>
        {lastActivityLabel ?? t('students.indicators.neverPlayed')}
      </Chip>
    </ul>
  );
}

/** Whether the student has any completed attempts — when false, callers
 *  typically render the "Copy invite link" affordance instead of indicators. */
export function wasEverActive(summary: StudentSummary): boolean {
  return summary.totalAttempts > 0 || summary.lastAttemptAt !== null;
}

interface ChipProps {
  Icon: typeof Target;
  children: React.ReactNode;
}

function Chip({ Icon, children }: ChipProps) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <Icon size={12} aria-hidden className="text-ink-subtle" />
      <span>{children}</span>
    </li>
  );
}

/**
 * Coarse relative-time using `Intl.RelativeTimeFormat`. We bucket into the
 * largest meaningful unit so a 2-day-old timestamp doesn't render "48h ago".
 */
function formatRelative(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diffSec / 86_400), 'day');
  if (abs < 86_400 * 365) return rtf.format(Math.round(diffSec / (86_400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86_400 * 365)), 'year');
}
