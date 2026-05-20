import { useTranslation } from 'react-i18next';

/** Phase 12: "Level N/5" chip shown while playing. Difficulty is fixed for the
 *  play and rises across plays, so this also signals progress. */
export function LevelBadge({ level, levelMax }: { level: number; levelMax?: number }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="play-level"
      data-level={level}
      className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-semibold text-indigo-800"
    >
      {t('play.levelBadge', { level, max: levelMax ?? 5 })}
    </span>
  );
}

/** Subtle "seen before" chip on a spaced-repetition review question. */
export function ReviewMarker() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="play-review-marker"
      className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
    >
      {t('play.reviewMarker')}
    </span>
  );
}
