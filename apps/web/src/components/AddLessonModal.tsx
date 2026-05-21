import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';
import { Button, Modal } from './ui';

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
    <Modal
      open={open}
      onClose={onClose}
      testId="add-lesson-modal"
      title={t('lessons.manualAdd.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="add-lesson-form"
            disabled={!occurredAtLocal}
            loading={mutation.isPending}
            data-testid="add-lesson-submit"
          >
            {mutation.isPending ? t('common.workingOn') : t('lessons.manualAdd.submit')}
          </Button>
        </>
      }
    >
      <form id="add-lesson-form" onSubmit={onSubmit}>
        <label htmlFor="new-lesson-occurredAt" className="block text-sm font-medium">
          {t('lessons.manualAdd.occurredAtLabel')}
        </label>
        <input
          id="new-lesson-occurredAt"
          type="datetime-local"
          required
          dir="ltr"
          // 900s = 15-minute increments in the time picker (12:00, 12:15, …).
          // The default value is rounded to the hour, so it stays step-aligned.
          step={900}
          value={occurredAtLocal}
          onChange={(e) => setOccurredAtLocal(e.target.value)}
          className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
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
          className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
          data-testid="add-lesson-title"
        />

        {errorMessage && (
          <p role="alert" className="mt-3 text-sm text-rose-700" data-testid="add-lesson-error">
            {errorMessage}
          </p>
        )}
      </form>
    </Modal>
  );
}
