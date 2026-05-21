import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameQuestion, GameResponse } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { useGame } from '../lib/games';
import { Bidi } from './Bidi';
import { Toast } from './Toast';
import { Button, Modal } from './ui';

interface Props {
  open: boolean;
  gameId: string;
  onClose: () => void;
}

/**
 * The tutor's review surface for a freshly-generated game pool. Lets them:
 *   - edit prompt / answer / acceptAlternates / distractors per question
 *   - regenerate one question (synchronous round-trip to the LLM)
 *   - regenerate the whole pool (re-enqueues; polls until status flips)
 *   - assign to the student (DRAFT → ASSIGNED)
 *
 * Polls the game endpoint while status === GENERATING via useGame so the
 * pool appears as soon as the worker finishes.
 */
export function QuestionReviewModal({ open, gameId, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: game } = useGame(open ? gameId : undefined);
  const [editing, setEditing] = useState<GameQuestion[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null);

  // Reset edit buffer whenever the server pool changes underneath us
  // (initial fetch, regenerate-all). We only adopt the new pool while
  // there are no pending tutor edits to avoid clobbering work in progress.
  useEffect(() => {
    if (!open || !game) return;
    if (editing === null) {
      setEditing(game.questionPool);
    }
  }, [open, game, editing]);

  // Reset when modal closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setEditing(null);
      setPendingQuestionId(null);
    }
  }, [open]);

  const dirty = useMemo(() => {
    if (!editing || !game) return false;
    if (editing.length !== game.questionPool.length) return true;
    return editing.some((q, i) => {
      const orig = game.questionPool[i];
      if (!orig) return true;
      return (
        q.id !== orig.id ||
        q.prompt !== orig.prompt ||
        q.answer !== orig.answer ||
        q.distractors.join('|') !== orig.distractors.join('|') ||
        q.acceptAlternates.join('|') !== orig.acceptAlternates.join('|')
      );
    });
  }, [editing, game]);

  // Resolve a mutation error to a toast message. A 429 always means the
  // tutor's monthly generation cap was hit; anything else gets the
  // operation-specific generic fallback.
  const errorToast = (err: unknown, genericKey: string): string =>
    err instanceof ApiError && err.status === 429
      ? t('review.error.quota')
      : t(genericKey);

  const saveMutation = useMutation({
    mutationFn: () => api.updateGame(gameId, { questions: editing ?? [] }),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setEditing(next.questionPool);
      setToast(t('review.toast.saved'));
    },
    onError: (err) => setToast(errorToast(err, 'review.error.save')),
  });

  const regenAllMutation = useMutation({
    mutationFn: () => api.regenerateGame(gameId),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setEditing(null);
      setToast(t('review.toast.regenerating'));
    },
    onError: (err) => setToast(errorToast(err, 'review.error.regenerateAll')),
  });

  const regenOneMutation = useMutation<GameResponse, ApiError, string>({
    mutationFn: (questionId) => api.regenerateGameQuestion(gameId, { questionId }),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setEditing(next.questionPool);
      setPendingQuestionId(null);
    },
    onError: (err) => {
      setPendingQuestionId(null);
      setToast(errorToast(err, 'review.error.regenerateOne'));
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => api.assignGame(gameId),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setToast(t('review.toast.assigned'));
      // Close shortly after so the tutor sees the toast.
      window.setTimeout(() => onClose(), 600);
    },
    onError: (err) => setToast(errorToast(err, 'review.error.assign')),
  });

  // Loading / GENERATING shell — keep the modal mounted so polling continues.
  const isGenerating = !game || game.status === 'GENERATING';
  const showActions =
    !isGenerating && game && (game.status === 'DRAFT' || game.status === 'ASSIGNED');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      testId="question-review-modal"
      closeTestId="review-close"
      dismissable={!saveMutation.isPending && !assignMutation.isPending}
      title={game ? <Bidi>{game.title}</Bidi> : t('review.loadingTitle')}
      footer={
        showActions ? (
          <>
            <Button
              variant="secondary"
              onClick={() => regenAllMutation.mutate()}
              disabled={assignMutation.isPending}
              loading={regenAllMutation.isPending}
              data-testid="review-regenerate-all"
            >
              {regenAllMutation.isPending ? t('common.workingOn') : t('review.regenerateAll')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || assignMutation.isPending}
              loading={saveMutation.isPending}
              data-testid="review-save"
            >
              {saveMutation.isPending ? t('common.workingOn') : t('review.saveEdits')}
            </Button>
            <Button
              onClick={() => {
                // If there are pending edits, save first so the assigned pool reflects them.
                if (dirty) {
                  saveMutation.mutate(undefined, {
                    onSuccess: () => assignMutation.mutate(),
                  });
                } else {
                  assignMutation.mutate();
                }
              }}
              disabled={saveMutation.isPending}
              loading={assignMutation.isPending}
              data-testid="review-assign"
            >
              {assignMutation.isPending
                ? t('common.workingOn')
                : game?.status === 'ASSIGNED'
                  ? t('review.reassign')
                  : t('review.assign')}
            </Button>
          </>
        ) : undefined
      }
    >
      <p className="text-sm text-ink-muted">
        {game?.type === 'FILL_BLANK'
          ? t('review.subtitleFillBlank')
          : game?.type === 'TIMED_QUIZ'
            ? t('review.subtitleTimedQuiz')
            : t('review.subtitleGeneric')}
      </p>

      {game && (
        <p
          data-testid="review-visibility"
          className={`mt-3 rounded px-3 py-2 text-sm ${
            game.status === 'ASSIGNED'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border border-sky-200 bg-sky-50 text-sky-900'
          }`}
        >
          {game.status === 'ASSIGNED'
            ? t('review.visibility.live')
            : t('review.visibility.draft')}
        </p>
      )}

      {isGenerating && (
        <div
          data-testid="review-generating"
          className="mt-6 rounded border border-dashed border-line-strong bg-surface-muted p-6 text-center text-sm text-ink-muted"
        >
          <p>{t('review.generating')}</p>
          <p className="mt-1 text-xs text-ink-subtle">{t('review.generatingHint')}</p>
        </div>
      )}

      {!isGenerating && game?.status === 'FAILED' && (
        <div
          role="alert"
          data-testid="review-failed"
          className="mt-6 rounded border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900"
        >
          <p className="font-medium">{t('review.failedTitle')}</p>
          <p className="mt-1">
            {game.generationError === 'AI_UNAVAILABLE_CIRCUIT_OPEN'
              ? t('review.failedBreaker')
              : t('review.failedGeneric')}
          </p>
          <button
            type="button"
            onClick={() => regenAllMutation.mutate()}
            disabled={regenAllMutation.isPending}
            className="mt-3 rounded bg-rose-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            data-testid="review-retry"
          >
            {regenAllMutation.isPending ? t('common.workingOn') : t('review.retry')}
          </button>
        </div>
      )}

      {showActions && (
        <div className="mt-6 space-y-4">
          {(editing ?? game!.questionPool).map((q, idx) => (
            <QuestionRow
              key={q.id}
              index={idx}
              question={q}
              onChange={(next) => {
                setEditing((prev) => {
                  const base = prev ?? game!.questionPool;
                  return base.map((p) => (p.id === q.id ? next : p));
                });
              }}
              onRegenerate={() => {
                setPendingQuestionId(q.id);
                regenOneMutation.mutate(q.id);
              }}
              regenerating={pendingQuestionId === q.id && regenOneMutation.isPending}
              showDistractors={game!.type === 'TIMED_QUIZ'}
            />
          ))}
        </div>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="review-toast" />}
    </Modal>
  );
}

interface RowProps {
  index: number;
  question: GameQuestion;
  showDistractors: boolean;
  regenerating: boolean;
  onChange: (next: GameQuestion) => void;
  onRegenerate: () => void;
}

function QuestionRow({ index, question, showDistractors, regenerating, onChange, onRegenerate }: RowProps) {
  const { t } = useTranslation();
  const distractorsText = question.distractors.join('\n');
  const alternatesText = question.acceptAlternates.join('\n');

  return (
    <article
      data-testid={`review-question-${question.id}`}
      className="rounded border border-line p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-ink-subtle">
          {t('review.questionLabel', { n: index + 1 })}
        </span>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="text-xs font-medium text-ink-muted underline-offset-2 hover:underline disabled:opacity-50"
          data-testid={`review-regenerate-${question.id}`}
        >
          {regenerating ? t('common.workingOn') : t('review.regenerateOne')}
        </button>
      </header>

      <label className="mt-2 block text-xs font-medium text-ink-muted">
        {t('review.fields.prompt')}
      </label>
      <textarea
        dir="auto"
        rows={2}
        value={question.prompt}
        onChange={(e) => onChange({ ...question, prompt: e.target.value })}
        className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
        data-testid={`review-prompt-${question.id}`}
      />

      <label className="mt-2 block text-xs font-medium text-ink-muted">
        {t('review.fields.answer')}
      </label>
      <input
        type="text"
        dir="auto"
        value={question.answer}
        onChange={(e) => onChange({ ...question, answer: e.target.value })}
        className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
        data-testid={`review-answer-${question.id}`}
      />

      {showDistractors && (
        <>
          <label className="mt-2 block text-xs font-medium text-ink-muted">
            {t('review.fields.distractors')}
          </label>
          <textarea
            dir="auto"
            rows={3}
            value={distractorsText}
            onChange={(e) =>
              onChange({
                ...question,
                distractors: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
            data-testid={`review-distractors-${question.id}`}
            placeholder={t('review.distractorsHint')}
          />
        </>
      )}

      <label className="mt-2 block text-xs font-medium text-ink-muted">
        {t('review.fields.alternates')}
      </label>
      <textarea
        dir="auto"
        rows={2}
        value={alternatesText}
        onChange={(e) =>
          onChange({
            ...question,
            acceptAlternates: e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        className="mt-1 w-full rounded border border-line-strong px-2 py-1 text-sm"
        data-testid={`review-alternates-${question.id}`}
        placeholder={t('review.alternatesHint')}
      />

      {question.topicTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {question.topicTags.map((tag) => (
            <span
              key={tag}
              dir="ltr"
              className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
