import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language, StudentResponse } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { LanguageSelect } from './LanguageSelect';
import { Button, Modal } from './ui';

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
    <Modal
      open={open}
      onClose={onClose}
      testId="add-student-modal"
      title={t('students.add.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="add-student-form"
            disabled={!name.trim()}
            loading={mutation.isPending}
            data-testid="add-student-submit"
          >
            {mutation.isPending ? t('common.workingOn') : t('students.add.submit')}
          </Button>
        </>
      }
    >
      <form id="add-student-form" onSubmit={onSubmit}>
        <label htmlFor="new-student-name" className="block text-sm font-medium">
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
      </form>
    </Modal>
  );
}
