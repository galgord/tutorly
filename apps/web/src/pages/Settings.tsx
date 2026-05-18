import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@tutor-app/shared';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const [confirmDeleteText, setConfirmDeleteText] = useState('');

  useEffect(() => {
    if (me.data) {
      setName(me.data.name ?? '');
      setLocale(me.data.locale);
    }
  }, [me.data]);

  const saveMutation = useMutation({
    mutationFn: () => api.updateMe({ name: name.trim() || undefined, locale }),
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
      <div data-testid="settings-loading" className="text-sm text-slate-600">
        {t('common.loading')}
      </div>
    );
  }

  const expectedConfirm = me.data.email;

  return (
    <section data-testid="settings" className="space-y-8">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="rounded-lg border border-slate-200 bg-white p-6"
      >
        <h2 className="text-lg font-semibold">{t('settings.profile.title')}</h2>

        <label htmlFor="email" className="mt-4 block text-sm font-medium">
          {t('settings.profile.email')}
        </label>
        <input
          id="email"
          type="email"
          dir="ltr"
          readOnly
          value={me.data.email}
          className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        />

        <label htmlFor="name" className="mt-4 block text-sm font-medium">
          {t('settings.profile.name')}
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="settings-name"
        />

        <label htmlFor="locale" className="mt-4 block text-sm font-medium">
          {t('settings.profile.locale')}
        </label>
        <select
          id="locale"
          dir="ltr"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="mt-1 rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="settings-locale"
        >
          <option value="en">English</option>
          <option value="pt">Português</option>
          <option value="he">עברית</option>
        </select>

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="mt-6 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          data-testid="settings-save"
        >
          {saveMutation.isPending ? t('common.workingOn') : t('settings.profile.save')}
        </button>
        {saveMutation.isSuccess && (
          <span
            role="status"
            className="ms-3 text-sm text-emerald-700"
            data-testid="settings-saved"
          >
            {t('settings.profile.saved')}
          </span>
        )}
      </form>

      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-semibold text-rose-900">{t('settings.delete.title')}</h2>
        <p className="mt-1 text-sm text-rose-900">{t('settings.delete.warning')}</p>
        <label htmlFor="confirm" className="mt-4 block text-sm font-medium">
          {t('settings.delete.confirmLabel', { email: me.data.email })}
        </label>
        <input
          id="confirm"
          type="text"
          dir="ltr"
          value={confirmDeleteText}
          onChange={(e) => setConfirmDeleteText(e.target.value)}
          className="mt-1 w-full rounded border border-rose-300 px-3 py-2 text-sm"
          data-testid="settings-delete-confirm"
        />
        <button
          type="button"
          disabled={confirmDeleteText !== expectedConfirm || deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          className="mt-4 rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          data-testid="settings-delete"
        >
          {deleteMutation.isPending ? t('common.workingOn') : t('settings.delete.button')}
        </button>
      </div>
    </section>
  );
}
