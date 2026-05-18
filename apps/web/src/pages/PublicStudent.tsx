import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { usePublicStudent } from '../lib/students';

export function PublicStudentPage() {
  const { t } = useTranslation();
  const params = useParams({ from: '/s/$shareToken' });
  const token = params.shareToken;
  const query = usePublicStudent(token);

  if (query.isLoading) {
    return (
      <p data-testid="public-student-loading" className="text-sm text-slate-600">
        {t('common.loading')}
      </p>
    );
  }

  if (!query.data) {
    return (
      <div
        data-testid="public-student-not-found"
        className="rounded-lg border border-slate-200 bg-white p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('publicStudent.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('publicStudent.notFoundBody')}</p>
      </div>
    );
  }

  return (
    <section data-testid="public-student" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t('publicStudent.greeting')} <Bidi>{query.data.name}</Bidi>
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('publicStudent.subtitle')}</p>
      </header>
      <div
        data-testid="public-student-empty"
        className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600"
      >
        {t('publicStudent.emptyGames')}
      </div>
    </section>
  );
}
