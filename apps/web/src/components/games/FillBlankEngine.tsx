import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicQuestion, StartAttemptResponse } from '@tutor-app/shared';
import { submitBufferedAnswer } from '../../lib/attempt-buffer';
import { LevelBadge, ReviewMarker } from './LevelBadge';

interface Props {
  shareToken: string;
  attempt: StartAttemptResponse;
  onFinished: () => void;
}

interface AnsweredState {
  correct: boolean;
  correctAnswer: string;
  scoreSoFar: number;
}

/**
 * FILL_BLANK engine. The tutor's prompt contains `___`; the student
 * types into a text box. Server-side scoring is the source of truth —
 * the engine submits raw text and renders the server-returned
 * `correct` boolean + the correct answer.
 *
 * Accessibility:
 *  - Single text input with `dir="auto"` so Hebrew answers go RTL,
 *    English LTR, regardless of the UI locale.
 *  - Keyboard-only flow: Enter submits, Enter also advances. The
 *    "Next" button is auto-focused after grading so screen readers
 *    can announce the result.
 *  - Score badge in `aria-live="polite"` so updates are read out.
 */
export function FillBlankEngine({ shareToken, attempt, onFinished }: Props) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState('');
  const [answered, setAnswered] = useState<AnsweredState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const total = attempt.questions.length;
  const current: PublicQuestion | undefined = attempt.questions[idx];
  const progress = useMemo(() => `${idx + 1} / ${total}`, [idx, total]);
  const score = answered?.scoreSoFar ?? 0;

  // Focus the input whenever we land on a new question.
  useEffect(() => {
    if (!answered) inputRef.current?.focus();
    else nextRef.current?.focus();
  }, [idx, answered]);

  if (!current) {
    // Out of questions — engine should have transitioned via onFinished.
    return null;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || answered) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const r = await submitBufferedAnswer({
        shareToken,
        attemptId: attempt.attemptId,
        body: { questionId: current.id, rawAnswer: trimmed },
      });
      if (r.response) {
        setAnswered({
          correct: r.response.correct,
          correctAnswer: r.response.correctAnswer,
          scoreSoFar: r.response.scoreSoFar,
        });
      } else {
        // Offline — show a non-committal hint. The server is the
        // source of truth so we don't fake a correct/incorrect badge.
        setAnswered({
          correct: false,
          correctAnswer: t('play.offlineWillSyncLater'),
          scoreSoFar: score,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (idx + 1 >= total) {
      onFinished();
      return;
    }
    setIdx((i) => i + 1);
    setValue('');
    setAnswered(null);
  };

  // The "Next" button's keyboard handler: Enter advances, matching the
  // input's Enter-to-submit, so the entire flow is one-key.
  const onNextKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') next();
  };

  return (
    <section
      data-testid="fill-blank-engine"
      data-attempt-id={attempt.attemptId}
      className="space-y-6 rounded-lg border border-line bg-surface p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span
            data-testid="play-progress"
            className="text-sm font-medium text-ink-subtle"
          >
            {progress}
          </span>
          {attempt.level !== undefined && (
            <LevelBadge level={attempt.level} levelMax={attempt.levelMax} />
          )}
        </div>
        <span
          data-testid="play-score"
          aria-live="polite"
          className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold"
        >
          {t('play.scoreLabel', { score })}
        </span>
      </header>

      {current.isReview && (
        <div>
          <ReviewMarker />
        </div>
      )}

      <p
        data-testid="play-prompt"
        // The prompt may be Hebrew, English, or mixed. `dir="auto"` lets
        // the browser pick. The textual `___` token displays as part of
        // the prompt — no special render needed.
        dir="auto"
        className="text-lg leading-relaxed"
      >
        {current.prompt}
      </p>

      <form onSubmit={submit} className="space-y-4">
        <label htmlFor="play-fb-input" className="sr-only">
          {t('play.fillBlankInputLabel')}
        </label>
        <input
          ref={inputRef}
          id="play-fb-input"
          data-testid="play-answer-input"
          dir="auto"
          value={value}
          disabled={!!answered || submitting}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded border border-line-strong px-3 py-2 text-base"
        />

        {!answered && (
          <div className="flex justify-end">
            <button
              type="submit"
              data-testid="play-submit"
              disabled={!value.trim() || submitting}
              className="rounded bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? t('common.workingOn') : t('play.submit')}
            </button>
          </div>
        )}
      </form>

      {answered && (
        <div
          data-testid="play-feedback"
          data-correct={answered.correct ? 'true' : 'false'}
          aria-live="polite"
          className={`rounded-md p-4 text-sm ${
            answered.correct
              ? 'bg-emerald-50 text-emerald-900'
              : 'bg-amber-50 text-amber-900'
          }`}
        >
          <p className="font-semibold">
            {answered.correct ? t('play.feedbackCorrect') : t('play.feedbackWrong')}
          </p>
          {!answered.correct && (
            <p className="mt-1" dir="auto">
              {t('play.feedbackCorrectAnswer')}: <strong>{answered.correctAnswer}</strong>
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              ref={nextRef}
              type="button"
              data-testid="play-next"
              onClick={next}
              onKeyDown={onNextKeyDown}
              className="inline-flex items-center gap-2 rounded bg-ink px-5 py-2 text-sm font-medium text-white"
            >
              {idx + 1 >= total ? t('play.finish') : t('play.next')}
              {idx + 1 < total && (
                // Directional arrow — flipped in RTL via `.icon-flip`.
                <span aria-hidden="true" className="icon-flip" data-testid="play-next-arrow">
                  →
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
