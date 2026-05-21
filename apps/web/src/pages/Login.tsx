import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');

  const mutation = useMutation({
    mutationFn: (e: string) => api.requestMagicLink({ email: e }),
    onSuccess: (data) => {
      // Dev affordance: the API echoes the magic-link URL back in non-prod so
      // we can skip the "check your email" interstitial entirely. In prod the
      // field is stripped and the user follows the email link as normal.
      if (data.devMagicLinkUrl) {
        window.location.replace(data.devMagicLinkUrl);
      }
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate(email.trim());
  };

  if (mutation.isSuccess) {
    return (
      <div
        data-testid="login-sent"
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-900"
      >
        <h2 className="text-lg font-semibold">{t('login.sent.title')}</h2>
        <p className="mt-2 text-sm">{t('login.sent.body', { email })}</p>
      </div>
    );
  }

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.status === 429
        ? t('login.error.rateLimited')
        : mutation.error.status === 400
          ? t('login.error.invalidEmail')
          : t('login.error.generic')
      : null;

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">{t('login.title')}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t('login.subtitle')}</p>

      <label htmlFor="email" className="mt-6 block text-sm font-medium">
        {t('login.emailLabel')}
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        data-testid="login-email"
      />

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-rose-700" data-testid="login-error">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || !email.trim()}
        className="mt-6 rounded bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        data-testid="login-submit"
      >
        {mutation.isPending ? t('login.sending') : t('login.submit')}
      </button>
    </form>
  );
}
