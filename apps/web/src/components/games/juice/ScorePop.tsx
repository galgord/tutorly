import { useTranslation } from 'react-i18next';

interface Props {
  /** The points delta to show — ALWAYS the server's scoreSoFar delta. */
  points: number;
  className?: string;
}

/**
 * Floating "+N" that drifts up and fades on a correct answer. Decorative:
 * the score badge's `aria-live` announces the real total, so this is
 * `aria-hidden`. It renders whatever delta the caller passes — it never
 * computes points (the server owns scoring).
 */
export function ScorePop({ points, className }: Props) {
  const { t, i18n } = useTranslation();
  const formatted = new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en').format(points);
  return (
    <span
      data-testid="play-score-pop"
      aria-hidden="true"
      className={`pointer-events-none select-none whitespace-nowrap font-bold text-emerald-600 animate-score-pop ${className ?? ''}`}
    >
      {t('play.scorePopPlus', { points: formatted })}
    </span>
  );
}
