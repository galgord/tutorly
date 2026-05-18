import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('notFound.body')}</p>
      <a href="/" className="mt-4 inline-block text-sm font-medium underline">
        {t('notFound.home')}
      </a>
    </div>
  );
}
