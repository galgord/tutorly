import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language, Locale } from '@tutor-app/shared';
import { LanguageSelect } from '../components/LanguageSelect';
import { Button, Card, CardBody, CardHeader, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { useIntegrationStatus } from '../lib/integrations';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const integrationStatus = useIntegrationStatus();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const [subject, setSubject] = useState('');
  const [teachingLanguage, setTeachingLanguage] = useState<Language | null>(null);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');

  useEffect(() => {
    if (me.data) {
      setName(me.data.name ?? '');
      setBusinessName(me.data.businessName ?? '');
      setLocale(me.data.locale);
      setSubject(me.data.subject ?? '');
      setTeachingLanguage(me.data.teachingLanguage ?? null);
    }
  }, [me.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateMe({
        name: name.trim() || undefined,
        // `null` clears the field; empty string from the text input also
        // maps to `null` so the tutor can blank out a previously-set value.
        businessName: businessName.trim() === '' ? null : businessName.trim(),
        locale,
        subject: subject.trim() === '' ? null : subject.trim(),
        teachingLanguage,
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(['me'], updated);
      await i18n.changeLanguage(updated.locale);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteMe(),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['me'] });
      void navigate({ to: '/login' });
    },
  });

  if (me.isLoading || !me.data) {
    return (
      <div data-testid="settings-loading" className="text-sm text-ink-muted">
        {t('common.loading')}
      </div>
    );
  }

  // Hoisted so TS narrowing survives inside the Field render-prop closures.
  const meData = me.data;
  const expectedConfirm = meData.email;
  // Static path string surfaced in the danger-zone copy so the tutor knows
  // a full data export is available before deleting.
  const exportPath = '/me/export';

  return (
    <section data-testid="settings" className="space-y-8">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

      {/*
        One form spans the Profile + Teaching cards because all four fields
        (name, locale, subject, teachingLanguage) save through a single
        `updateMe` mutation. The save action lives in the Teaching card footer.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="space-y-8"
      >
        {/* --- Profile -------------------------------------------------- */}
        <Card>
          <CardHeader>
            <div>
              <h2 className="text-lg font-semibold">{t('settings.profile.title')}</h2>
              <p className="text-sm text-ink-muted">{t('settings.profile.description')}</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label={t('settings.profile.email')} hint={t('settings.profile.emailHint')}>
              {(id) => (
                <Input id={id} type="email" dir="ltr" readOnly value={meData.email} />
              )}
            </Field>

            <Field label={t('settings.profile.name')}>
              {(id) => (
                <Input
                  id={id}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="settings-name"
                />
              )}
            </Field>

            <Field
              label={t('settings.profile.businessName')}
              hint={t('settings.profile.businessNameHint')}
            >
              {(id) => (
                <Input
                  id={id}
                  type="text"
                  dir="auto"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  data-testid="settings-business-name"
                  maxLength={120}
                />
              )}
            </Field>

            <Field label={t('settings.profile.locale')}>
              {(id) => (
                <select
                  id={id}
                  dir="ltr"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Locale)}
                  className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                  data-testid="settings-locale"
                >
                  <option value="en">English</option>
                  <option value="pt">Português</option>
                  <option value="he">עברית</option>
                </select>
              )}
            </Field>
          </CardBody>
        </Card>

        {/* --- Teaching ------------------------------------------------- */}
        <Card>
          <CardHeader>
            <div>
              <h2 className="text-lg font-semibold">{t('settings.teaching.title')}</h2>
              <p className="text-sm text-ink-muted">{t('settings.teaching.description')}</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field
              label={t('settings.teaching.subject')}
              hint={t('settings.teaching.subjectHint')}
            >
              {(id) => (
                <Input
                  id={id}
                  type="text"
                  dir="auto"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t('settings.teaching.subjectPlaceholder')}
                  data-testid="settings-subject"
                  maxLength={80}
                />
              )}
            </Field>

            <Field
              label={t('settings.teaching.teachingLanguage')}
              hint={t('settings.teaching.teachingLanguageHint')}
            >
              {(id) => (
                <LanguageSelect
                  id={id}
                  value={teachingLanguage}
                  emptyLabel={t('settings.teaching.teachingLanguageNone')}
                  onChange={setTeachingLanguage}
                  className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                  testId="settings-teaching-language"
                />
              )}
            </Field>
          </CardBody>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <Button type="submit" loading={saveMutation.isPending} data-testid="settings-save">
              {saveMutation.isPending ? t('common.workingOn') : t('settings.profile.save')}
            </Button>
            {saveMutation.isSuccess && (
              <span role="status" className="text-sm text-emerald-700" data-testid="settings-saved">
                {t('settings.profile.saved')}
              </span>
            )}
          </div>
        </Card>
      </form>

      {/* --- Integrations ---------------------------------------------- */}
      <Card data-testid="settings-integrations">
        <CardHeader>
          <div>
            <h2 className="text-lg font-semibold">{t('settings.integrations.title')}</h2>
            <p className="text-sm text-ink-muted">{t('settings.integrations.description')}</p>
          </div>
        </CardHeader>
        <CardBody>
          <Link
            to="/settings/integrations"
            data-testid="settings-integrations-link"
            className="inline-flex items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          >
            {integrationStatus.data?.connected
              ? t('settings.integrations.manage')
              : t('settings.integrations.connect')}
          </Link>
        </CardBody>
      </Card>

      {/* --- Danger zone ----------------------------------------------- */}
      <Card className="border-rose-200">
        <CardHeader className="border-rose-200 bg-rose-50">
          <h2 className="text-lg font-semibold text-rose-900">{t('settings.delete.title')}</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-rose-900">{t('settings.delete.warning')}</p>
          <p className="text-sm text-ink-muted">
            {t('settings.delete.exportHint', { path: exportPath })}
          </p>
          <Field label={t('settings.delete.confirmLabel', { email: meData.email })}>
            {(id) => (
              <Input
                id={id}
                type="text"
                dir="ltr"
                value={confirmDeleteText}
                onChange={(e) => setConfirmDeleteText(e.target.value)}
                className="border-rose-300"
                data-testid="settings-delete-confirm"
              />
            )}
          </Field>
          <Button
            variant="danger"
            disabled={confirmDeleteText !== expectedConfirm}
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            data-testid="settings-delete"
          >
            {deleteMutation.isPending ? t('common.workingOn') : t('settings.delete.button')}
          </Button>
        </CardBody>
      </Card>
    </section>
  );
}
