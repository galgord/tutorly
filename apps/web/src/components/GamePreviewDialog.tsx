import { useQuery } from '@tanstack/react-query';
import type { GameQuestion, GameResponse } from '@tutor-app/shared';
import { scoreAnswer } from '@tutor-app/shared';
import { Eye } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';
import { Button, Modal } from './ui';

interface Props {
  /** The game to preview; the dialog is open whenever this is non-null. */
  gameId: string | null;
  onClose: () => void;
}

/**
 * Tutor "play as a student" preview — runs as a dialog (no route change) so
 * it can be opened from anywhere a game appears. Uses the shared `scoreAnswer`
 * so the verdict matches the real student experience; nothing is persisted.
 */
export function GamePreviewDialog({ gameId, onClose }: Props) {
  const { t } = useTranslation();

  const game = useQuery<GameResponse | null, ApiError>({
    queryKey: ['game', gameId],
    queryFn: async () => {
      try {
        return await api.getGame(gameId!);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!gameId,
    staleTime: 30_000,
  });

  return (
    <Modal
      open={!!gameId}
      onClose={onClose}
      size="lg"
      testId="game-preview-dialog"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {game.data?.title ?? t('preview.title')}
          <span
            data-testid="preview-mode-banner"
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
          >
            <Eye size={12} aria-hidden /> {t('preview.banner')}
          </span>
        </span>
      }
    >
      {game.isLoading && <p className="text-sm text-ink-muted">{t('common.loading')}</p>}
      {!game.isLoading && !game.data && (
        <p data-testid="game-preview-not-found" className="text-sm text-ink-muted">
          {t('preview.notFoundBody')}
        </p>
      )}
      {game.data && (
        <PreviewPlayer
          key={game.data.id}
          type={game.data.type}
          questions={game.data.questionPool}
          locale={game.data.locale}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

interface PreviewPlayerProps {
  type: GameResponse['type'];
  questions: GameQuestion[];
  locale: string;
  onClose: () => void;
}

function PreviewPlayer({ type, questions, locale, onClose }: PreviewPlayerProps) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [graded, setGraded] = useState<null | { correct: boolean; correctAnswer: string }>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const current = questions[idx];
  const total = questions.length;

  useEffect(() => {
    if (!graded) inputRef.current?.focus();
  }, [idx, graded]);

  const choices = useMemo<string[]>(() => {
    if (!current || type !== 'TIMED_QUIZ') return [];
    return shuffleSeeded([current.answer, ...current.distractors.slice(0, 3)], current.id);
  }, [current, type]);

  if (!current) return null;

  const gradeRaw = (raw: string) => {
    const r = scoreAnswer({
      rawAnswer: raw,
      expected: current.answer,
      acceptAlternates: current.acceptAlternates,
      locale,
    });
    if (r.correct) setScore((s) => s + 1);
    setGraded({ correct: r.correct, correctAnswer: current.answer });
  };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || graded) return;
    gradeRaw(trimmed);
  };

  const next = () => {
    if (idx + 1 >= total) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setValue('');
    setGraded(null);
  };

  const restart = () => {
    setIdx(0);
    setScore(0);
    setGraded(null);
    setValue('');
    setDone(false);
  };

  if (done) {
    return (
      <div
        data-testid="preview-summary"
        data-score={score}
        data-total={total}
        className="space-y-4 text-center"
      >
        <h2 className="text-xl font-semibold text-ink">{t('preview.summary.title')}</h2>
        <p className="text-3xl font-bold text-ink" data-testid="preview-summary-score">
          {t('preview.summary.score', { score, total })}
        </p>
        <p className="text-sm text-ink-muted">{t('preview.summary.body')}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={restart} data-testid="preview-restart">
            {t('preview.summary.again')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid="preview-back">
            {t('preview.summary.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="preview-player">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-ink-muted">
          {t('preview.progress', { idx: idx + 1, total })}
        </span>
        <span
          aria-live="polite"
          className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold text-ink"
        >
          {t('preview.score', { score })}
        </span>
      </div>

      <p data-testid="preview-prompt" dir="auto" className="text-lg leading-relaxed">
        {current.prompt}
      </p>

      {type === 'FILL_BLANK' ? (
        <form onSubmit={submitText} className="space-y-3">
          <label htmlFor="preview-input" className="sr-only">
            {t('play.fillBlankInputLabel')}
          </label>
          <input
            ref={inputRef}
            id="preview-input"
            dir="auto"
            value={value}
            disabled={!!graded}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            data-testid="preview-input"
          />
          {!graded && (
            <div className="flex justify-end">
              <Button type="submit" disabled={!value.trim()} data-testid="preview-submit">
                {t('play.submit')}
              </Button>
            </div>
          )}
        </form>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {choices.map((c, i) => (
            <li key={`${current.id}-${i}`}>
              <button
                type="button"
                dir="auto"
                onClick={() => !graded && gradeRaw(c)}
                disabled={!!graded}
                data-testid={`preview-choice-${i}`}
                className={[
                  'w-full rounded-md border px-3 py-2 text-start text-sm transition',
                  graded
                    ? c === current.answer
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-line text-ink-muted opacity-60'
                    : 'border-line bg-surface text-ink hover:border-brand-300 hover:bg-brand-50',
                ].join(' ')}
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}

      {graded && (
        <div
          data-testid="preview-feedback"
          data-correct={graded.correct ? 'true' : 'false'}
          className={[
            'rounded-md p-4 text-sm',
            graded.correct ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900',
          ].join(' ')}
        >
          <p className="font-semibold">
            {graded.correct ? t('play.feedbackCorrect') : t('play.feedbackWrong')}
          </p>
          {!graded.correct && (
            <p className="mt-1" dir="auto">
              {t('play.feedbackCorrectAnswer')}: <strong>{graded.correctAnswer}</strong>
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Button onClick={next} data-testid="preview-next" autoFocus>
              {idx + 1 >= total ? t('play.finish') : t('play.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Stable per-question pseudo-shuffle so re-renders don't reorder choices. */
function shuffleSeeded<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 9301 + 49297) % 233280;
    const j = Math.floor((h / 233280) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
