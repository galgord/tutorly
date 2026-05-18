import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddStudentModal } from '../components/AddStudentModal';
import { Bidi } from '../components/Bidi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Toast } from '../components/Toast';
import { api } from '../lib/api';
import { buildShareUrl, useStudents } from '../lib/students';

const PAGE_SIZE = 10;

export function StudentsListPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const list = useStudents({ q: search.trim() || undefined, page, limit: PAGE_SIZE });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteStudent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      await qc.invalidateQueries({ queryKey: ['trash-students'] });
      setDeleteTarget(null);
      setToast(t('students.toast.deleted'));
    },
  });

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onCopyShare = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token));
      setToast(t('students.toast.linkCopied'));
    } catch {
      setToast(t('students.toast.linkCopyFailed'));
    }
  };

  const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
    dateStyle: 'medium',
  });

  return (
    <section data-testid="students-list" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('students.title')}</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/students/trash"
            className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
            data-testid="students-trash-link"
          >
            {t('students.trashLink')}
          </Link>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            data-testid="students-add-button"
          >
            {t('students.add.button')}
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="students-search" className="sr-only">
          {t('students.searchLabel')}
        </label>
        <input
          id="students-search"
          type="search"
          dir="auto"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t('students.searchPlaceholder')}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="students-search"
        />
      </div>

      {list.isLoading && (
        <p data-testid="students-loading" className="text-sm text-slate-600">
          {t('common.loading')}
        </p>
      )}

      {!list.isLoading && items.length === 0 && (
        <div
          data-testid="students-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600"
        >
          {search.trim() ? t('students.emptySearch') : t('students.emptyAll')}
        </div>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((s) => (
            <li
              key={s.id}
              data-testid={`student-row-${s.id}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to="/students/$id"
                  params={{ id: s.id }}
                  className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                  data-testid={`student-name-${s.id}`}
                >
                  <Bidi>{s.name}</Bidi>
                </Link>
                <p className="text-xs text-slate-500">
                  {t('students.row.lastLesson', {
                    date: dateFmt.format(new Date(s.createdAt)),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/students/$id"
                  params={{ id: s.id }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                  data-testid={`student-open-${s.id}`}
                >
                  {t('students.actions.open')}
                </Link>
                <button
                  type="button"
                  onClick={() => void onCopyShare(s.shareToken)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                  data-testid={`student-copy-${s.id}`}
                >
                  {t('students.actions.copyShare')}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget({ id: s.id, name: s.name })}
                  className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                  data-testid={`student-delete-${s.id}`}
                >
                  {t('students.actions.delete')}
                </button>
              </div>
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
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
            data-testid="students-prev"
          >
            {t('students.pagination.prev')}
          </button>
          <span>
            {t('students.pagination.status', { page, total: totalPages })}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
            data-testid="students-next"
          >
            {t('students.pagination.next')}
          </button>
        </nav>
      )}

      <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} />

      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        testId="delete-confirm"
        title={t('students.delete.title')}
        body={
          <p>
            {t('students.delete.warning')} <Bidi>{deleteTarget?.name ?? ''}</Bidi>
          </p>
        }
        expectedConfirmText={deleteTarget?.name ?? ''}
        confirmInputLabel={t('students.delete.confirmLabel', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('students.delete.button')}
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="students-toast" />}
    </section>
  );
}
