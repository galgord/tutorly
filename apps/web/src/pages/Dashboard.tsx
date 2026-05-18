import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      void navigate({ to: '/login' });
    },
  });

  if (me.isLoading) {
    return (
      <div data-testid="dashboard-loading" className="text-sm text-slate-600">
        {t('common.loading')}
      </div>
    );
  }

  if (!me.data) {
    return null;
  }

  return (
    <section data-testid="dashboard" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t('dashboard.welcome', { name: me.data.name ?? me.data.email.split('@')[0] }) as string}{' '}
          <Bidi>{me.data.name ?? me.data.email}</Bidi>
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('dashboard.subtitle')}</p>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
        <p>{t('dashboard.emptyStudents')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Link
            to="/students"
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            data-testid="dashboard-students-link"
          >
            {t('dashboard.studentsLink')}
          </Link>
          <Link
            to="/calendar"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            data-testid="dashboard-calendar-link"
          >
            {t('nav.calendar')}
          </Link>
          <Link
            to="/settings/integrations"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            data-testid="dashboard-integrations-link"
          >
            {t('nav.integrations')}
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <a
          href="/settings"
          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
        >
          {t('dashboard.settingsLink')}
        </a>
        <button
          type="button"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          data-testid="logout-button"
        >
          {logoutMutation.isPending ? t('common.workingOn') : t('dashboard.logout')}
        </button>
      </div>
    </section>
  );
}
