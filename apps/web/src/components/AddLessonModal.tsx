import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';

interface Props {
  open: boolean;
  studentId: string;
  onClose: () => void;
  onCreated?: (lessonId: string) => void;
}

/**
 * Modal for adding a lesson manually (no Google Calendar required). The
 * datetime-local input is treated as the tutor's local time and converted
 * to ISO at submit time.
 */
export function AddLessonModal({ open, studentId, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [occurredAtLocal, setOccurredAtLocal] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (open) {
      // Default to "now, rounded to the hour" in local time so the field is
      // pre-filled and submit-ready.
      const now = new Date();
      now.setMinutes(0, 0, 0);
      // datetime-local needs YYYY-MM-DDTHH:MM in local tz.
      const pad = (n: number) => String(n).padStart(2, '0');
      const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
        now.getHours(),
      )}:${pad(now.getMinutes())}`;
      setOccurredAtLocal(local);
      setTitle('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: () => {
      const occurredAt = new Date(occurredAtLocal).toISOString();
      return api.createLesson({
        studentId,
        occurredAt,
        title: title.trim() || undefined,
      });
    },
    onSuccess: async (lesson) => {
      await qc.invalidateQueries({ queryKey: ['lessons'] });
      await qc.invalidateQueries({ queryKey: ['calendar'] });
      onCreated?.(lesson.id);
      onClose();
    },
  });

  if (!open) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!occurredAtLocal) return;
    mutation.mutate();
  };

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.status === 400
        ? t('lessons.manualAdd.errors.invalid')
        : t('lessons.manualAdd.errors.generic')
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-lesson-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        data-testid="add-lesson-modal"
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            // Close sits on the inline-start edge (visual-left in LTR,
            // visual-right in RTL) per Phase 8 RTL convention.
            className="me-1 text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
          <h2 id="add-lesson-title" className="flex-1 text-lg font-semibold">
            {t('lessons.manualAdd.title')}
          </h2>
        </div>

        <label htmlFor="new-lesson-occurredAt" className="mt-4 block text-sm font-medium">
          {t('lessons.manualAdd.occurredAtLabel')}
        </label>
        <input
          id="new-lesson-occurredAt"
          type="datetime-local"
          required
          dir="ltr"
          value={occurredAtLocal}
          onChange={(e) => setOccurredAtLocal(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="add-lesson-occurredAt"
          autoFocus
        />

        <label htmlFor="new-lesson-title" className="mt-4 block text-sm font-medium">
          {t('lessons.manualAdd.titleLabel')}
        </label>
        <input
          id="new-lesson-title"
          type="text"
          dir="auto"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="add-lesson-title"
        />

        {errorMessage && (
          <p role="alert" className="mt-3 text-sm text-rose-700" data-testid="add-lesson-error">
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!occurredAtLocal || mutation.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            data-testid="add-lesson-submit"
          >
            {mutation.isPending ? t('common.workingOn') : t('lessons.manualAdd.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
