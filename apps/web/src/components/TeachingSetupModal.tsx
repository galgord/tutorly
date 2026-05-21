import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { LanguageSelect } from './LanguageSelect';
import { Button, Field, Input, Modal } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * First-run setup shown on the Dashboard when the tutor has not yet set a
 * `subject`. Captures the subject + teaching language that shape the quality
 * of AI-generated practice games. Dismissible — the tutor can skip and set
 * these later from Settings.
 */
export function TeachingSetupModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [teachingLanguage, setTeachingLanguage] = useState<Language | null>(null);

  useEffect(() => {
    if (open) {
      setSubject('');
      setTeachingLanguage(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.updateMe({
        subject: subject.trim(),
        teachingLanguage: teachingLanguage ?? undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;
    mutation.mutate();
  };

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.status === 400
        ? t('teachingSetup.errors.invalid')
        : t('teachingSetup.errors.generic')
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      testId="teaching-setup-modal"
      title={t('teachingSetup.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-testid="teaching-setup-skip">
            {t('teachingSetup.skip')}
          </Button>
          <Button
            type="submit"
            form="teaching-setup-form"
            disabled={!subject.trim()}
            loading={mutation.isPending}
            data-testid="teaching-setup-submit"
          >
            {mutation.isPending ? t('common.workingOn') : t('teachingSetup.submit')}
          </Button>
        </>
      }
    >
      <form id="teaching-setup-form" onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-ink-muted">{t('teachingSetup.explainer')}</p>

        <Field label={t('teachingSetup.subjectLabel')}>
          {(id) => (
            <Input
              id={id}
              type="text"
              required
              dir="auto"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('teachingSetup.subjectPlaceholder')}
              data-testid="teaching-setup-subject"
              autoFocus
            />
          )}
        </Field>

        <Field label={t('teachingSetup.languageLabel')} hint={t('teachingSetup.languageHint')}>
          {(id) => (
            <LanguageSelect
              id={id}
              value={teachingLanguage}
              emptyLabel={t('teachingSetup.languageNone')}
              onChange={setTeachingLanguage}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              testId="teaching-setup-language"
            />
          )}
        </Field>

        {errorMessage && (
          <p role="alert" className="text-sm text-rose-700" data-testid="teaching-setup-error">
            {errorMessage}
          </p>
        )}
      </form>
    </Modal>
  );
}
