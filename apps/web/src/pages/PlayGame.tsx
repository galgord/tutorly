import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  FinishAttemptResponse,
  StartAttemptResponse,
} from '@tutor-app/shared';
import { FillBlankEngine } from '../components/games/FillBlankEngine';
import { TimedQuizEngine } from '../components/games/TimedQuizEngine';
import { ApiError, api } from '../lib/api';
import { clearAttemptBuffer, installOnlineFlusher } from '../lib/attempt-buffer';

/**
 * `/s/:shareToken/play/:gameId` — student plays an assigned game.
 *
 * Lifecycle:
 *   1. On mount, POST start-attempt → render the appropriate engine.
 *   2. Engine PATCHes each answer (server is source of truth).
 *   3. On finish (or game-over), POST /finish → show summary + Play
 *      Again CTA.
 *   4. On unmount of a finished attempt, clear its buffered entries.
 */
export function PlayGamePage() {
  const { t } = useTranslation();
  const params = useParams({ from: '/s/$shareToken/play/$gameId' });
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<StartAttemptResponse | null>(null);
  const [summary, setSummary] = useState<FinishAttemptResponse | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // Hydrate the student's name so the back-link reads naturally.
  const studentQuery = useQuery({
    queryKey: ['public-student', params.shareToken],
    queryFn: () => api.publicStudent(params.shareToken),
    retry: false,
  });

  // Start the attempt once on mount.
  const start = useMutation({
    mutationFn: () => api.startAttempt(params.shareToken, params.gameId),
    onSuccess: (data) => setAttempt(data),
    onError: (err: ApiError) => {
      if (err.status === 404) setErrorKey('play.startNotFound');
      else if (err.status === 400) setErrorKey('play.startNoQuestions');
      else setErrorKey('play.startGeneric');
    },
  });

  useEffect(() => {
    start.mutate();
    const unsubscribe = installOnlineFlusher();
    return unsubscribe;
    // Intentionally only re-runs when the game id changes; `start.mutate`
    // is stable across renders, react-query handles its own identity.
  }, [params.gameId]); // eslint-disable-line

  // Finish the attempt.
  const finish = useMutation({
    mutationFn: () => api.finishAttempt(params.shareToken, attempt!.attemptId),
    onSuccess: async (data) => {
      setSummary(data);
      await clearAttemptBuffer(attempt!.attemptId);
    },
    onError: () => setErrorKey('play.finishGeneric'),
  });

  const goBack = () =>
    navigate({ to: '/s/$shareToken', params: { shareToken: params.shareToken } });

  // Restart for the "Play Again" button.
  const playAgain = () => {
    setSummary(null);
    setAttempt(null);
    setErrorKey(null);
    start.mutate();
  };

  // ---- Render -------------------------------------------------------

  if (errorKey) {
    return (
      <ErrorState
        title={t('play.errorTitle')}
        body={t(errorKey)}
        retryLabel={t('play.tryAgain')}
        onRetry={() => {
          setErrorKey(null);
          start.mutate();
        }}
        onBack={goBack}
        backLabel={t('play.backToDashboard')}
      />
    );
  }

  if (!attempt || start.isPending) {
    return (
      <p data-testid="play-loading" className="text-sm text-ink-muted">
        {t('play.loading')}
      </p>
    );
  }

  if (summary) {
    return (
      <SummaryView
        summary={summary}
        playAgainLabel={t('play.playAgain')}
        backLabel={t('play.backToDashboard')}
        scoreLabel={t('play.summaryScore', {
          score: summary.score,
          total: summary.total,
        })}
        bestEverLabel={
          summary.bestEver > 0
            ? t('play.summaryBestEver', { best: summary.bestEver })
            : t('play.summaryFirstPlay')
        }
        beatPersonalBest={summary.score > summary.bestEver}
        beatLabel={t('play.summaryBeatBest')}
        leveledUp={summary.leveledUp ?? false}
        levelUpLabel={
          summary.nextLevel != null
            ? `${t('play.leveledUp')} ${t('play.summaryNextLevel', { level: summary.nextLevel })}`
            : t('play.leveledUp')
        }
        title={t('play.summaryTitle')}
        playerName={studentQuery.data?.name ?? ''}
        onPlayAgain={playAgain}
        onBack={goBack}
      />
    );
  }

  const onEngineFinished = () => {
    finish.mutate();
  };

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <button
          type="button"
          data-testid="play-back"
          onClick={goBack}
          className="text-sm text-ink-muted underline-offset-2 hover:underline"
        >
          {t('play.backToDashboard')}
        </button>
      </header>
      {attempt.type === 'FILL_BLANK' ? (
        <FillBlankEngine
          shareToken={params.shareToken}
          attempt={attempt}
          onFinished={onEngineFinished}
        />
      ) : (
        <TimedQuizEngine
          shareToken={params.shareToken}
          attempt={attempt}
          onFinished={onEngineFinished}
        />
      )}
    </section>
  );
}

interface SummaryProps {
  summary: FinishAttemptResponse;
  title: string;
  scoreLabel: string;
  bestEverLabel: string;
  beatPersonalBest: boolean;
  beatLabel: string;
  leveledUp: boolean;
  levelUpLabel: string;
  playAgainLabel: string;
  backLabel: string;
  playerName: string;
  onPlayAgain: () => void;
  onBack: () => void;
}

function SummaryView({
  summary,
  title,
  scoreLabel,
  bestEverLabel,
  beatPersonalBest,
  beatLabel,
  leveledUp,
  levelUpLabel,
  playAgainLabel,
  backLabel,
  onPlayAgain,
  onBack,
}: SummaryProps) {
  return (
    <section
      data-testid="play-summary"
      data-score={summary.score}
      data-total={summary.total}
      className="space-y-6 rounded-lg border border-line bg-surface p-6 text-center"
    >
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-4xl font-bold" data-testid="play-summary-score">
        {scoreLabel}
      </p>
      {leveledUp && (
        <p
          className="text-base font-semibold text-indigo-700"
          data-testid="play-summary-levelup"
        >
          {levelUpLabel}
        </p>
      )}
      {beatPersonalBest && (
        <p className="text-sm font-medium text-emerald-700" data-testid="play-summary-beat">
          {beatLabel}
        </p>
      )}
      <p className="text-sm text-ink-muted" data-testid="play-summary-best">
        {bestEverLabel}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          data-testid="play-again"
          onClick={onPlayAgain}
          className="rounded bg-ink px-5 py-2 text-sm font-medium text-white"
        >
          {playAgainLabel}
        </button>
        <button
          type="button"
          data-testid="play-summary-back"
          onClick={onBack}
          className="rounded border border-line-strong px-5 py-2 text-sm font-medium"
        >
          {backLabel}
        </button>
      </div>
    </section>
  );
}

interface ErrorProps {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
  backLabel: string;
  onBack: () => void;
}

function ErrorState({ title, body, retryLabel, onRetry, backLabel, onBack }: ErrorProps) {
  return (
    <section
      data-testid="play-error"
      className="space-y-4 rounded-lg border border-rose-200 bg-rose-50 p-6 text-center"
    >
      <h1 className="text-xl font-semibold text-rose-900">{title}</h1>
      <p className="text-sm text-rose-800">{body}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          data-testid="play-error-retry"
          onClick={onRetry}
          className="rounded bg-ink px-5 py-2 text-sm font-medium text-white"
        >
          {retryLabel}
        </button>
        <button
          type="button"
          data-testid="play-error-back"
          onClick={onBack}
          className="rounded border border-line-strong px-5 py-2 text-sm font-medium"
        >
          {backLabel}
        </button>
      </div>
    </section>
  );
}
