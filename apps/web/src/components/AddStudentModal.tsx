import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language, StudentResponse } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { LanguageSelect } from './LanguageSelect';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (student: StudentResponse) => void;
}

export function AddStudentModal({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState<Language | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setNotes('');
      setNativeLanguage(null);
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
    mutationFn: () =>
      api.createStudent({
        name: name.trim(),
        notes: notes.trim() || undefined,
        nativeLanguage: nativeLanguage ?? undefined,
      }),
    onSuccess: async (student) => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      onCreated?.(student);
      onClose();
    },
  });

  if (!open) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.status === 400
        ? t('students.add.errors.invalid')
        : t('students.add.errors.generic')
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-student-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl"
        data-testid="add-student-modal"
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            // Close sits on the inline-start edge (visual-left in LTR,
            // visual-right in RTL) per Phase 8 RTL convention.
            className="me-1 text-ink-subtle hover:text-ink-muted"
          >
            ×
          </button>
          <h2 id="add-student-title" className="flex-1 text-lg font-semibold">
            {t('students.add.title')}
          </h2>
        </div>

        <label htmlFor="new-student-name" className="mt-4 block text-sm font-medium">
          {t('students.fields.name')}
        </label>
        <input
          id="new-student-name"
          type="text"
          required
          dir="auto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
          data-testid="add-student-name"
          autoFocus
        />

        <label htmlFor="new-student-notes" className="mt-4 block text-sm font-medium">
          {t('students.fields.notes')} <span className="text-xs text-ink-subtle">{t('common.optional')}</span>
        </label>
        <textarea
          id="new-student-notes"
          dir="auto"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
          data-testid="add-student-notes"
        />

        <label htmlFor="new-student-native-language" className="mt-4 block text-sm font-medium">
          {t('students.fields.nativeLanguage')}{' '}
          <span className="text-xs text-ink-subtle">{t('common.optional')}</span>
        </label>
        <LanguageSelect
          id="new-student-native-language"
          value={nativeLanguage}
          emptyLabel={t('students.fields.nativeLanguageNone')}
          onChange={setNativeLanguage}
          testId="add-student-native-language"
        />
        <p className="mt-1 text-xs text-ink-subtle">{t('students.fields.nativeLanguageHint')}</p>

        {errorMessage && (
          <p role="alert" className="mt-3 text-sm text-rose-700" data-testid="add-student-error">
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || mutation.isPending}
            className="rounded bg-ink px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            data-testid="add-student-submit"
          >
            {mutation.isPending ? t('common.workingOn') : t('students.add.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
