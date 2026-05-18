import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicQuestion, StartAttemptResponse } from '@tutor-app/shared';
import { submitBufferedAnswer } from '../../lib/attempt-buffer';

interface Props {
  shareToken: string;
  attempt: StartAttemptResponse;
  onFinished: () => void;
}

interface AnsweredState {
  questionId: string;
  correct: boolean;
  correctAnswer: string;
  scoreSoFar: number;
  livesRemaining: number;
  gameOver: boolean;
  pickedIndex: number;
}

/**
 * TIMED_QUIZ engine. Multiple-choice with a per-question countdown.
 * Wrong or time-out costs a life; 3 lives lost = game over.
 *
 * The pool re-shuffles when exhausted so the engine appears infinite,
 * matching the spec's "infinite until lives gone". (The server caps
 * at the sampled size, but the engine cycles through them.)
 *
 * RTL: the countdown bar uses `inlineSize` so it shrinks from the
 * start edge in both LTR and RTL. Lives are rendered with logical
 * ordering and `dir="auto"` on the prompt.
 */
export function TimedQuizEngine({ shareToken, attempt, onFinished }: Props) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<number[]>(() =>
    attempt.questions.map((_, i) => i),
  );
  const [cursor, setCursor] = useState(0);
  const [answered, setAnswered] = useState<AnsweredState | null>(null);
  const [score, setScore] = useState(0);
  const [livesRemaining, setLivesRemaining] = useState(attempt.livesAllowed);
  const [timeLeft, setTimeLeft] = useState(attempt.perQuestionSeconds);
  const [submitting, setSubmitting] = useState(false);
  const tickRef = useRef<number | null>(null);
  const finishingRef = useRef(false);

  const currentIndex = order[cursor] ?? 0;
  const current: PublicQuestion | undefined = attempt.questions[currentIndex];
  const choicesForCurrent = current?.choices ?? [];

  // ---- Timer hooks ---------------------------------------------------
  const clearTimer = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // Submit helper — defined before useEffect so it can be a dep.
  const submit = useCallback(
    async (pickedIndex: number, timedOut = false) => {
      if (!current || submitting || answered) return;
      setSubmitting(true);
      clearTimer();
      try {
        const r = await submitBufferedAnswer({
          shareToken,
          attemptId: attempt.attemptId,
          body: timedOut
            ? { questionId: current.id, timedOut: true }
            : { questionId: current.id, choiceIndex: pickedIndex },
        });
        if (r.response) {
          setScore(r.response.scoreSoFar);
          if (typeof r.response.livesRemaining === 'number') {
            setLivesRemaining(r.response.livesRemaining);
          }
          setAnswered({
            questionId: current.id,
            correct: r.response.correct,
            correctAnswer: r.response.correctAnswer,
            scoreSoFar: r.response.scoreSoFar,
            livesRemaining: r.response.livesRemaining ?? livesRemaining,
            gameOver: r.response.gameOver,
            pickedIndex,
          });
        } else {
          // Offline — treat as wrong so the engine progresses safely;
          // server will reconcile on reconnect via the buffered flush.
          setAnswered({
            questionId: current.id,
            correct: false,
            correctAnswer: t('play.offlineWillSyncLater'),
            scoreSoFar: score,
            livesRemaining: Math.max(0, livesRemaining - 1),
            gameOver: false,
            pickedIndex,
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      answered,
      attempt.attemptId,
      clearTimer,
      current,
      livesRemaining,
      score,
      shareToken,
      submitting,
      t,
    ],
  );

  // Start countdown whenever we land on a new question.
  useEffect(() => {
    if (answered || !current) {
      clearTimer();
      return;
    }
    setTimeLeft(attempt.perQuestionSeconds);
    tickRef.current = window.setInterval(() => {
      setTimeLeft((tl) => {
        if (tl <= 1) {
          // Timed out — score as wrong via the submit helper.
          clearTimer();
          void submit(-1, true);
          return 0;
        }
        return tl - 1;
      });
    }, 1000);
    return clearTimer;
  }, [answered, attempt.perQuestionSeconds, clearTimer, current, submit]);

  // ---- Next-question + game-over wiring ------------------------------
  const next = useCallback(() => {
    if (!answered) return;
    if (answered.gameOver || answered.livesRemaining <= 0) {
      if (finishingRef.current) return;
      finishingRef.current = true;
      onFinished();
      return;
    }
    // Out of sampled questions: reshuffle so the student can keep
    // playing (spec calls for "infinite"). New order, fresh cursor.
    if (cursor + 1 >= order.length) {
      const reshuffled = [...attempt.questions.keys()].sort(() => Math.random() - 0.5);
      setOrder(reshuffled);
      setCursor(0);
    } else {
      setCursor((c) => c + 1);
    }
    setAnswered(null);
  }, [answered, attempt.questions, cursor, onFinished, order.length]);

  // Pre-compute the bar width.
  const barWidthPct = useMemo(() => {
    if (!attempt.perQuestionSeconds) return 0;
    return Math.max(0, Math.min(100, (timeLeft / attempt.perQuestionSeconds) * 100));
  }, [timeLeft, attempt.perQuestionSeconds]);

  if (!current) return null;

  // 3 lives rendered as filled / hollow hearts. We render LIVES_ALLOWED
  // slots so the layout doesn't jump when lives are lost.
  const lifeIcons = Array.from({ length: attempt.livesAllowed }, (_, i) => i < livesRemaining);

  return (
    <section
      data-testid="timed-quiz-engine"
      data-attempt-id={attempt.attemptId}
      className="space-y-6 rounded-lg border border-slate-200 bg-white p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <span
          data-testid="play-score"
          aria-live="polite"
          className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold"
        >
          {t('play.scoreLabel', { score })}
        </span>
        <ul
          data-testid="play-lives"
          aria-label={t('play.livesAriaLabel', { remaining: livesRemaining })}
          className="flex items-center gap-1"
        >
          {lifeIcons.map((filled, i) => (
            <li
              key={i}
              aria-hidden="true"
              className={`text-lg ${filled ? 'text-rose-600' : 'text-slate-300'}`}
              data-testid={`play-life-${i}`}
              data-filled={filled ? 'true' : 'false'}
            >
              {filled ? '♥' : '♡'}
            </li>
          ))}
        </ul>
      </header>

      <div
        data-testid="play-timer"
        role="progressbar"
        aria-label={t('play.timerAriaLabel', { seconds: timeLeft })}
        aria-valuenow={timeLeft}
        aria-valuemin={0}
        aria-valuemax={attempt.perQuestionSeconds}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full bg-slate-900 transition-[inline-size] duration-300 ease-linear"
          // Logical inline-size so the bar drains from start-edge in
          // both LTR and RTL (in RTL, "left" would be the wrong edge).
          style={{ inlineSize: `${barWidthPct}%` }}
        />
      </div>

      <p data-testid="play-prompt" dir="auto" className="text-lg leading-relaxed">
        {current.prompt}
      </p>

      <ul className="grid gap-2">
        {choicesForCurrent.map((choice, i) => {
          const isPicked = answered?.pickedIndex === i;
          const showAsCorrect = answered && choice === answered.correctAnswer;
          return (
            <li key={`${current.id}-${i}`}>
              <button
                type="button"
                data-testid={`play-choice-${i}`}
                disabled={!!answered || submitting}
                onClick={() => submit(i)}
                dir="auto"
                className={`w-full rounded border px-4 py-3 text-start text-base ${
                  showAsCorrect
                    ? 'border-emerald-500 bg-emerald-50'
                    : isPicked
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-slate-300 hover:bg-slate-50'
                } disabled:cursor-not-allowed`}
              >
                {choice}
              </button>
            </li>
          );
        })}
      </ul>

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
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              data-testid="play-next"
              onClick={next}
              className="rounded bg-slate-900 px-5 py-2 text-sm font-medium text-white"
            >
              {answered.gameOver || answered.livesRemaining <= 0
                ? t('play.finish')
                : t('play.next')}
            </button>
          </div>
        </div>
      )}

      {choicesForCurrent.length === 0 && (
        // Defensive: a TIMED_QUIZ question with no distractors shouldn't
        // happen (server enforces), but render a friendly note rather
        // than a blank screen if it does.
        <p data-testid="play-no-choices" className="text-sm text-amber-700">
          {t('play.noChoices')}
        </p>
      )}
    </section>
  );
}
