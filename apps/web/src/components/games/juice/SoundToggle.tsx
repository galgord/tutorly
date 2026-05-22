import { Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isSoundEnabled, setSoundEnabled, unlockAudio } from './sound';

/**
 * Mute toggle for game sound. Persists to localStorage (via the sound module)
 * and defaults ON. Independent of reduced motion — silencing audio and calming
 * motion are different needs. Enabling also unlocks the AudioContext, since the
 * click is a user gesture.
 */
export function SoundToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(isSoundEnabled);

  const toggle = () => {
    setOn((prev) => {
      const next = !prev;
      setSoundEnabled(next);
      if (next) unlockAudio();
      return next;
    });
  };

  return (
    <button
      type="button"
      data-testid="play-sound-toggle"
      aria-pressed={on}
      aria-label={on ? t('play.soundOn') : t('play.soundOff')}
      title={on ? t('play.soundOn') : t('play.soundOff')}
      onClick={toggle}
      className={`rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-sunken ${className ?? ''}`}
    >
      {on ? (
        <Volume2 aria-hidden="true" className="h-5 w-5" />
      ) : (
        <VolumeX aria-hidden="true" className="h-5 w-5" />
      )}
    </button>
  );
}
