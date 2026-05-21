import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { Toast } from '../components/Toast';
import { api } from '../lib/api';
import { useTrashStudents } from '../lib/students';

const PAGE_SIZE = 10;

export function StudentsTrashPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);

  const list = useTrashStudents({ page, limit: PAGE_SIZE });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.restoreStudent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['trash-students'] });
      await qc.invalidateQueries({ queryKey: ['students'] });
      setToast(t('students.toast.restored'));
    },
  });

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
    dateStyle: 'medium',
  });

  return (
    <section data-testid="students-trash" className="space-y-6">
      <header>
        <Link
          to="/students"
          className="text-sm font-medium text-ink-muted underline-offset-2 hover:underline"
          data-testid="trash-back"
        >
          {t('students.trash.back')}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{t('students.trash.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('students.trash.subtitle')}</p>
      </header>

      {list.isLoading && (
        <p data-testid="trash-loading" className="text-sm text-ink-muted">
          {t('common.loading')}
        </p>
      )}

      {!list.isLoading && items.length === 0 && (
        <div
          data-testid="trash-empty"
          className="rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-ink-muted"
        >
          {t('students.trash.empty')}
        </div>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {items.map((s) => (
            <li
              key={s.id}
              data-testid={`trash-row-${s.id}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  <Bidi>{s.name}</Bidi>
                </p>
                <p className="text-xs text-ink-subtle">
                  {t('students.trash.deletedOn', {
                    date: s.deletedAt ? dateFmt.format(new Date(s.deletedAt)) : '',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restoreMutation.mutate(s.id)}
                disabled={restoreMutation.isPending}
                className="rounded border border-line-strong px-3 py-1 text-xs hover:bg-surface-muted disabled:opacity-50"
                data-testid={`trash-restore-${s.id}`}
              >
                {restoreMutation.isPending ? t('common.workingOn') : t('students.trash.restore')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav
          aria-label={t('students.pagination.label')}
          className="flex items-center justify-between text-sm"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-line-strong px-3 py-1 disabled:opacity-50"
            data-testid="trash-prev"
          >
            {t('students.pagination.prev')}
          </button>
          <span>{t('students.pagination.status', { page, total: totalPages })}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded border border-line-strong px-3 py-1 disabled:opacity-50"
            data-testid="trash-next"
          >
            {t('students.pagination.next')}
          </button>
        </nav>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="trash-toast" />}
    </section>
  );
}
