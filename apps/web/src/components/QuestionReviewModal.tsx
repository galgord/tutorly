import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameQuestion, GameResponse } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { useGame } from '../lib/games';
import { Bidi } from './Bidi';
import { Toast } from './Toast';

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

  const saveMutation = useMutation({
    mutationFn: () => api.updateGame(gameId, { questions: editing ?? [] }),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setEditing(next.questionPool);
      setToast(t('review.toast.saved'));
    },
  });

  const regenAllMutation = useMutation({
    mutationFn: () => api.regenerateGame(gameId),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setEditing(null);
      setToast(t('review.toast.regenerating'));
    },
  });

  const regenOneMutation = useMutation<GameResponse, ApiError, string>({
    mutationFn: (questionId) => api.regenerateGameQuestion(gameId, { questionId }),
    onSuccess: async (next) => {
      qc.setQueryData(['game', gameId], next);
      await qc.invalidateQueries({ queryKey: ['lesson-games', next.lessonId] });
      setEditing(next.questionPool);
      setPendingQuestionId(null);
    },
    onError: () => setPendingQuestionId(null),
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
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saveMutation.isPending && !assignMutation.isPending) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, saveMutation.isPending, assignMutation.isPending]);

  if (!open) return null;

  // Loading / GENERATING shell — keep the modal mounted so polling continues.
  const isGenerating = !game || game.status === 'GENERATING';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="question-review-modal"
        className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="review-title" className="text-lg font-semibold">
              {game ? <Bidi>{game.title}</Bidi> : t('review.loadingTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {game?.type === 'FILL_BLANK'
                ? t('review.subtitleFillBlank')
                : game?.type === 'TIMED_QUIZ'
                  ? t('review.subtitleTimedQuiz')
                  : t('review.subtitleGeneric')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="ms-2 text-slate-400 hover:text-slate-600"
            data-testid="review-close"
          >
            ×
          </button>
        </div>

        {isGenerating && (
          <div
            data-testid="review-generating"
            className="mt-6 rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600"
          >
            <p>{t('review.generating')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('review.generatingHint')}</p>
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

        {!isGenerating && game && (game.status === 'DRAFT' || game.status === 'ASSIGNED') && (
          <>
            <div className="mt-6 space-y-4">
              {(editing ?? game.questionPool).map((q, idx) => (
                <QuestionRow
                  key={q.id}
                  index={idx}
                  question={q}
                  onChange={(next) => {
                    setEditing((prev) => {
                      const base = prev ?? game.questionPool;
                      return base.map((p) => (p.id === q.id ? next : p));
                    });
                  }}
                  onRegenerate={() => {
                    setPendingQuestionId(q.id);
                    regenOneMutation.mutate(q.id);
                  }}
                  regenerating={pendingQuestionId === q.id && regenOneMutation.isPending}
                  showDistractors={game.type === 'TIMED_QUIZ'}
                />
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => regenAllMutation.mutate()}
                disabled={regenAllMutation.isPending || assignMutation.isPending}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                data-testid="review-regenerate-all"
              >
                {regenAllMutation.isPending ? t('common.workingOn') : t('review.regenerateAll')}
              </button>
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={!dirty || saveMutation.isPending || assignMutation.isPending}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                data-testid="review-save"
              >
                {saveMutation.isPending ? t('common.workingOn') : t('review.saveEdits')}
              </button>
              <button
                type="button"
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
                disabled={assignMutation.isPending || saveMutation.isPending}
                className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                data-testid="review-assign"
              >
                {assignMutation.isPending
                  ? t('common.workingOn')
                  : game.status === 'ASSIGNED'
                    ? t('review.reassign')
                    : t('review.assign')}
              </button>
            </div>
          </>
        )}

        {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="review-toast" />}
      </div>
    </div>
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
      className="rounded border border-slate-200 p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-slate-500">
          {t('review.questionLabel', { n: index + 1 })}
        </span>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline disabled:opacity-50"
          data-testid={`review-regenerate-${question.id}`}
        >
          {regenerating ? t('common.workingOn') : t('review.regenerateOne')}
        </button>
      </header>

      <label className="mt-2 block text-xs font-medium text-slate-600">
        {t('review.fields.prompt')}
      </label>
      <textarea
        dir="auto"
        rows={2}
        value={question.prompt}
        onChange={(e) => onChange({ ...question, prompt: e.target.value })}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        data-testid={`review-prompt-${question.id}`}
      />

      <label className="mt-2 block text-xs font-medium text-slate-600">
        {t('review.fields.answer')}
      </label>
      <input
        type="text"
        dir="auto"
        value={question.answer}
        onChange={(e) => onChange({ ...question, answer: e.target.value })}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        data-testid={`review-answer-${question.id}`}
      />

      {showDistractors && (
        <>
          <label className="mt-2 block text-xs font-medium text-slate-600">
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
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            data-testid={`review-distractors-${question.id}`}
            placeholder={t('review.distractorsHint')}
          />
        </>
      )}

      <label className="mt-2 block text-xs font-medium text-slate-600">
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
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        data-testid={`review-alternates-${question.id}`}
        placeholder={t('review.alternatesHint')}
      />

      {question.topicTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {question.topicTags.map((tag) => (
            <span
              key={tag}
              dir="ltr"
              className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
