import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SUPPORTED_LOCALES, type Language, type Locale } from '@tutor-app/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { LanguageSelect } from './LanguageSelect';
import { Button, Field, Input, Modal } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Endonyms — each UI language shown in its own script. */
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  pt: 'Português',
  he: 'עברית',
};

const CONTROL_CLASS =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink';

/**
 * First-run setup shown on the Dashboard when the tutor has not yet set a
 * `subject`. Captures, in order: the app's interface language (applied live),
 * the tutor's name + business name, the subject, and the teaching language —
 * the latter two shape AI-generated games. Dismissible — these can also be set
 * later from Settings.
 */
export function TeachingSetupModal({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [appLocale, setAppLocale] = useState<Locale>(
    (i18n.resolvedLanguage ?? 'en') as Locale,
  );
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [subject, setSubject] = useState('');
  const [teachingLanguage, setTeachingLanguage] = useState<Language | null>(null);

  useEffect(() => {
    if (open) {
      setAppLocale((i18n.resolvedLanguage ?? 'en') as Locale);
      setName(me.data?.name ?? '');
      setBusinessName(me.data?.businessName ?? '');
      setSubject('');
      setTeachingLanguage(null);
    }
  }, [open, i18n.resolvedLanguage, me.data?.name, me.data?.businessName]);

  // Apply the chosen interface language immediately so the rest of the
  // modal — and everything behind it — is in the tutor's language.
  const onPickAppLocale = (next: Locale) => {
    setAppLocale(next);
    void i18n.changeLanguage(next);
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.updateMe({
        locale: appLocale,
        name: name.trim(),
        // Empty optional field maps to `null` (clear) rather than omitted.
        businessName: businessName.trim() === '' ? null : businessName.trim(),
        subject: subject.trim(),
        teachingLanguage: teachingLanguage ?? undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    },
  });

  const canSubmit = subject.trim() !== '' && name.trim() !== '';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
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
            disabled={!canSubmit}
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

        <Field
          label={t('teachingSetup.appLanguageLabel')}
          hint={t('teachingSetup.appLanguageHint')}
        >
          {(id) => (
            <select
              id={id}
              dir="ltr"
              value={appLocale}
              onChange={(e) => onPickAppLocale(e.target.value as Locale)}
              className={CONTROL_CLASS}
              data-testid="teaching-setup-app-language"
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_LABELS[loc]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={t('teachingSetup.nameLabel')}>
          {(id) => (
            <Input
              id={id}
              type="text"
              required
              dir="auto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('teachingSetup.namePlaceholder')}
              data-testid="teaching-setup-name"
              autoFocus
            />
          )}
        </Field>

        <Field
          label={t('teachingSetup.businessNameLabel')}
          hint={t('teachingSetup.businessNameHint')}
        >
          {(id) => (
            <Input
              id={id}
              type="text"
              dir="auto"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={t('teachingSetup.businessNamePlaceholder')}
              data-testid="teaching-setup-business-name"
              maxLength={120}
            />
          )}
        </Field>

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
              className={CONTROL_CLASS}
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
