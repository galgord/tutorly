import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicQuestion, StartAttemptResponse } from '@tutor-app/shared';
import { submitBufferedAnswer } from '../../lib/attempt-buffer';
import { LevelBadge, ReviewMarker } from './LevelBadge';
import { ScorePop, StreakMeter, useGameJuice } from './juice';

// Per-bubble accent tints for the unanswered state. Full class strings (no
// interpolation) so Tailwind's content scanner keeps them. Deliberately avoids
// emerald (= correct) and rose (= wrong) so the answered state reads clearly.
const BUBBLE_ACCENTS = [
  'border-sky-300 bg-sky-50 hover:bg-sky-100',
  'border-violet-300 bg-violet-50 hover:bg-violet-100',
  'border-amber-300 bg-amber-50 hover:bg-amber-100',
  'border-fuchsia-300 bg-fuchsia-50 hover:bg-fuchsia-100',
];

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
  const juice = useGameJuice();
  // Hold juice in a ref so `submit`'s useCallback deps stay stable — juice's
  // object identity changes each render and the timer effect depends on submit.
  const juiceRef = useRef(juice);
  juiceRef.current = juice;
  const prevScoreRef = useRef(0);
  const [scorePop, setScorePop] = useState<{ points: number; nonce: number } | null>(null);

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
      juiceRef.current.unlockAudio(); // first-gesture audio unlock (autoplay policy)
      try {
        const r = await submitBufferedAnswer({
          shareToken,
          attemptId: attempt.attemptId,
          body: timedOut
            ? { questionId: current.id, timedOut: true }
            : { questionId: current.id, choiceIndex: pickedIndex },
        });
        if (r.response) {
          const delta = r.response.scoreSoFar - prevScoreRef.current;
          prevScoreRef.current = r.response.scoreSoFar;
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
          // Juice reacts to the SERVER verdict; a timeout counts as wrong.
          juiceRef.current.onAnswer({ correct: r.response.correct, timedOut });
          if (r.response.correct && delta > 0) {
            setScorePop({ points: delta, nonce: Date.now() });
          }
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
    setScorePop(null); // don't carry the previous question's +N forward
  }, [answered, attempt.questions, cursor, onFinished, order.length]);

  // Auto-dismiss the floating "+N" after its drift-up animation.
  useEffect(() => {
    if (!scorePop) return;
    const id = window.setTimeout(() => setScorePop(null), 850);
    return () => window.clearTimeout(id);
  }, [scorePop]);

  // Pre-compute the bar width.
  const barWidthPct = useMemo(() => {
    if (!attempt.perQuestionSeconds) return 0;
    return Math.max(0, Math.min(100, (timeLeft / attempt.perQuestionSeconds) * 100));
  }, [timeLeft, attempt.perQuestionSeconds]);

  if (!current) return null;

  // 3 lives rendered as filled / hollow hearts. We render LIVES_ALLOWED
  // slots so the layout doesn't jump when lives are lost.
  const lifeIcons = Array.from({ length: attempt.livesAllowed }, (_, i) => i < livesRemaining);

  // The bubble <button> — identical markup in both the static grid and the
  // rising-bubble field, so every play-choice-* testid + handler is shared.
  const renderBubbleButton = (choice: string, i: number) => {
    const isPicked = answered?.pickedIndex === i;
    const isCorrect = answered != null && choice === answered.correctAnswer;
    let stateClass: string;
    if (!answered) {
      stateClass = `${BUBBLE_ACCENTS[i % BUBBLE_ACCENTS.length]} text-ink`;
    } else if (isCorrect) {
      // The right answer "pops" (pulse, stays visible) when you nailed it.
      stateClass = `border-emerald-500 bg-emerald-100 text-emerald-900${isPicked ? ' animate-pop' : ''}`;
    } else if (isPicked) {
      stateClass = 'border-rose-400 bg-rose-100 text-rose-900 animate-wobble';
    } else {
      stateClass = 'border-line bg-surface text-ink-muted opacity-60';
    }
    return (
      <button
        type="button"
        data-testid={`play-choice-${i}`}
        disabled={!!answered || submitting}
        onClick={() => submit(i)}
        dir="auto"
        className={`min-h-[56px] w-full rounded-2xl border-2 px-4 py-3 text-center text-base font-semibold transition-transform hover:scale-[1.02] disabled:cursor-not-allowed ${stateClass}`}
      >
        {choice}
      </button>
    );
  };

  return (
    <section
      data-testid="timed-quiz-engine"
      data-attempt-id={attempt.attemptId}
      className="space-y-6 rounded-lg border border-line bg-surface p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span
              data-testid="play-score"
              aria-live="polite"
              className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold"
            >
              {t('play.scoreLabel', { score })}
            </span>
            {scorePop && (
              <ScorePop
                key={scorePop.nonce}
                points={scorePop.points}
                className="absolute -top-5 end-1 text-base"
              />
            )}
          </div>
          {attempt.level !== undefined && (
            <LevelBadge level={attempt.level} levelMax={attempt.levelMax} />
          )}
          <StreakMeter streak={juice.streak} />
        </div>
        <ul
          data-testid="play-lives"
          aria-label={t('play.livesAriaLabel', { remaining: livesRemaining })}
          className="flex items-center gap-1"
        >
          {lifeIcons.map((filled, i) => (
            <li
              key={i}
              aria-hidden="true"
              className={`text-lg ${filled ? 'text-rose-600' : 'text-ink-subtle'} ${
                answered && !answered.correct && i === livesRemaining ? 'animate-heart-loss' : ''
              }`}
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
        className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full bg-ink transition-[inline-size] duration-300 ease-linear"
          // Logical inline-size so the bar drains from start-edge in
          // both LTR and RTL (in RTL, "left" would be the wrong edge).
          style={{ inlineSize: `${barWidthPct}%` }}
        />
      </div>

      {current.isReview && (
        <div>
          <ReviewMarker />
        </div>
      )}

      <div className="space-y-1.5">
        <p data-testid="play-prompt" dir="auto" className="text-lg leading-relaxed">
          {current.prompt}
        </p>
        {current.promptTranslation && (
          // L1 translation of the prompt for students whose native language
          // differs from the question's language. `dir="auto"` handles RTL.
          <p
            data-testid="play-prompt-translation"
            dir="auto"
            className="text-sm leading-relaxed text-ink-muted"
          >
            {current.promptTranslation}
          </p>
        )}
      </div>

      {/* Answer Blast bubbles. Reduced motion → a plain static grid (also the
          deterministic E2E layout). Otherwise → the same grid, but each bubble
          floats with a continuous buoyant bob (staggered per index). The float
          stops once answered so the pop/shake + feedback read clearly. Both
          paths share renderBubbleButton, so the play-choice-* testids +
          handlers are identical. */}
      <div className="grid grid-cols-2 gap-4">
        {choicesForCurrent.map((choice, i) => (
          <div key={`${current.id}-${i}`} className="flex items-center justify-center py-2">
            <div
              className={`w-full ${juice.reducedMotion || answered ? '' : 'animate-float will-change-transform'}`}
              style={juice.reducedMotion || answered ? undefined : { animationDelay: `${-i * 0.7}s` }}
            >
              {renderBubbleButton(choice, i)}
            </div>
          </div>
        ))}
      </div>

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
              className="inline-flex items-center gap-2 rounded bg-ink px-5 py-2 text-sm font-medium text-white"
            >
              {answered.gameOver || answered.livesRemaining <= 0
                ? t('play.finish')
                : t('play.next')}
              {!answered.gameOver && answered.livesRemaining > 0 && (
                // Directional arrow — flipped in RTL via `.icon-flip`.
                <span aria-hidden="true" className="icon-flip" data-testid="play-next-arrow">
                  →
                </span>
              )}
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
