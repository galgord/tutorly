import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { StudentListItem } from '@tutor-app/shared';
import { Link as LinkIcon, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddStudentModal } from '../components/AddStudentModal';
import { Bidi } from '../components/Bidi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StudentIndicators, wasEverActive } from '../components/StudentIndicators';
import { StudentRowMenu } from '../components/StudentRowMenu';
import { Toast } from '../components/Toast';
import { api } from '../lib/api';
import { buildShareUrl, useStudents } from '../lib/students';

const PAGE_SIZE = 10;

export function StudentsListPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<{ id: string; name: string } | null>(null);

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

  const rotateMutation = useMutation({
    mutationFn: (id: string) => api.rotateStudentToken(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      setRotateTarget(null);
      setToast(t('students.toast.tokenRotated'));
    },
  });

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onCopyInvite = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token));
      setToast(t('students.toast.linkCopied'));
    } catch {
      setToast(t('students.toast.linkCopyFailed'));
    }
  };

  return (
    <section data-testid="students-list" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">{t('students.title')}</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/students/trash"
            className="text-sm font-medium text-ink-muted hover:text-ink"
            data-testid="students-trash-link"
          >
            {t('students.trashLink')}
          </Link>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
            data-testid="students-add-button"
          >
            <Plus size={16} aria-hidden /> {t('students.add.button')}
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
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          data-testid="students-search"
        />
      </div>

      {list.isLoading && (
        <p data-testid="students-loading" className="text-sm text-ink-muted">
          {t('common.loading')}
        </p>
      )}

      {!list.isLoading && items.length === 0 && (
        <div
          data-testid="students-empty"
          className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-muted"
        >
          {search.trim() ? t('students.emptySearch') : t('students.emptyAll')}
        </div>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((s) => (
            <StudentListRow
              key={s.id}
              student={s}
              onCopyInvite={() => void onCopyInvite(s.shareToken)}
              onDelete={() => setDeleteTarget({ id: s.id, name: s.name })}
              onRotateToken={() => setRotateTarget({ id: s.id, name: s.name })}
            />
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
            className="rounded-md border border-line px-3 py-1 text-ink hover:bg-surface-sunken disabled:opacity-50"
            data-testid="students-prev"
          >
            {t('students.pagination.prev')}
          </button>
          <span className="text-ink-muted">
            {t('students.pagination.status', { page, total: totalPages })}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border border-line px-3 py-1 text-ink hover:bg-surface-sunken disabled:opacity-50"
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

      <ConfirmDialog
        open={!!rotateTarget}
        testId="rotate-confirm"
        title={t('students.rotate.title')}
        body={<p>{t('students.rotate.warning')}</p>}
        confirmLabel={t('students.rotate.button')}
        busy={rotateMutation.isPending}
        onConfirm={() => rotateTarget && rotateMutation.mutate(rotateTarget.id)}
        onCancel={() => setRotateTarget(null)}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="students-toast" />}
    </section>
  );
}

interface StudentListRowProps {
  student: StudentListItem;
  onCopyInvite: () => void;
  onDelete: () => void;
  onRotateToken: () => void;
}

function StudentListRow({ student, onCopyInvite, onDelete, onRotateToken }: StudentListRowProps) {
  const { t } = useTranslation();
  const initials = initialsFor(student.name);
  const everActive = wasEverActive(student.summary);

  return (
    <li className="relative">
      <Link
        to="/students/$id"
        params={{ id: student.id }}
        data-testid={`student-row-${student.id}`}
        className="flex items-center gap-4 px-4 py-3 hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p
              className="truncate text-sm font-semibold text-ink"
              data-testid={`student-name-${student.id}`}
            >
              <Bidi>{student.name}</Bidi>
            </p>
            {student.nativeLanguage && (
              <span className="text-xs text-ink-subtle">
                · {t('students.row.l1', { code: student.nativeLanguage.toUpperCase() })}
              </span>
            )}
          </div>
          <div className="mt-1">
            <StudentIndicators summary={student.summary} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!everActive && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCopyInvite();
              }}
              data-testid={`student-invite-${student.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
            >
              <LinkIcon size={12} aria-hidden /> {t('students.actions.invite')}
            </button>
          )}
          <StudentRowMenu
            studentId={student.id}
            onDelete={onDelete}
            onRotateToken={onRotateToken}
          />
        </div>
      </Link>
    </li>
  );
}

function initialsFor(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '–';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '–').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}
