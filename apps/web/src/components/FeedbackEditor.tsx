import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Toast } from './Toast';

interface Props {
  lessonId: string;
  initialFeedback: string;
  /** Tells the parent whether unsaved edits exist, so it can disable game
   * generation until the tutor saves (a fresh edit shouldn't generate from
   * the prior version). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Notified once a save lands, useful for clearing the "stale text" hint. */
  onSaved?: (text: string) => void;
}

/**
 * Free-text feedback editor for a lesson. Auto-warns on navigation when
 * there are unsaved edits; uses `dir="auto"` so the textarea direction
 * follows the content (Hebrew feedback → RTL, English → LTR), independent
 * of the UI locale.
 */
export function FeedbackEditor({ lessonId, initialFeedback, onDirtyChange, onSaved }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [value, setValue] = useState(initialFeedback);
  const [toast, setToast] = useState<string | null>(null);

  // Keep the editor in sync if the server-state changes underneath us
  // (e.g. another tab edited). Only when the user hasn't typed anything new.
  useEffect(() => {
    setValue(initialFeedback);
  }, [initialFeedback]);

  const dirty = value !== initialFeedback;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // beforeunload warning when there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const mutation = useMutation({
    mutationFn: () => api.setLessonFeedback(lessonId, { feedbackText: value.trim() }),
    onSuccess: async (updated) => {
      qc.setQueryData(['lesson', lessonId], updated);
      setToast(t('feedback.toast.saved'));
      onSaved?.(updated.feedbackText ?? '');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || value.trim().length === 0) return;
    mutation.mutate();
  };

  return (
    <form
      onSubmit={onSubmit}
      data-testid="feedback-editor"
      className="rounded-lg border border-line bg-surface p-6"
    >
      <header>
        <h2 className="text-lg font-semibold">{t('feedback.title')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('feedback.subtitle')}</p>
      </header>

      <label htmlFor="lesson-feedback-input" className="mt-4 block text-sm font-medium">
        {t('feedback.label')}
      </label>
      <textarea
        id="lesson-feedback-input"
        data-testid="feedback-input"
        dir="auto"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        maxLength={8_000}
        placeholder={t('feedback.placeholder')}
        className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-subtle">
        <span
          data-testid="feedback-charcount"
          className={value.length >= 8_000 * 0.9 ? 'text-amber-700' : undefined}
        >
          {t('feedback.charCount', { count: value.length, max: 8_000 })}
        </span>
        {dirty && (
          <span data-testid="feedback-dirty-indicator" className="text-amber-700">
            {t('feedback.unsaved')}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={!dirty || value.trim().length === 0 || mutation.isPending}
          className="rounded bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          data-testid="feedback-save"
        >
          {mutation.isPending ? t('common.workingOn') : t('feedback.save')}
        </button>
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="feedback-toast" />}
    </form>
  );
}
