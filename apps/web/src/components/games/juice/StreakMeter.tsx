import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { streakTier, type StreakState } from './streak';

const TIER_CLASS: Record<number, string> = {
  1: 'bg-amber-100 text-amber-800',
  2: 'bg-orange-100 text-orange-800',
  3: 'bg-rose-100 text-rose-700',
};

/**
 * Cosmetic flame + consecutive-correct count. Hidden below 2 so it only
 * appears once momentum is real, and "heats up" through three tiers
 * (3 / 5 / 10). It is NOT a score multiplier — pure flair.
 *
 * `key={streak.current}` re-mounts on each increment so the pulse replays.
 */
export function StreakMeter({ streak }: { streak: StreakState }) {
  const { t } = useTranslation();
  if (streak.current < 2) return null;
  const cls = TIER_CLASS[streakTier(streak.current)] ?? TIER_CLASS[1];
  return (
    <span
      key={streak.current}
      data-testid="play-streak"
      data-streak={streak.current}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold animate-streak-pulse ${cls}`}
    >
      <Flame aria-hidden="true" className="h-3.5 w-3.5" />
      {t('play.streakLabel', { count: streak.current })}
    </span>
  );
}
