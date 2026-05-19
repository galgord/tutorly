import { Link } from '@tanstack/react-router';
import type { StudentListItem } from '@tutor-app/shared';
import { Link as LinkIcon, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddStudentModal } from '../components/AddStudentModal';
import { Bidi } from '../components/Bidi';
import { InstallPrompt } from '../components/InstallPrompt';
import { OfflineBanner } from '../components/OfflineBanner';
import { StudentIndicators, wasEverActive } from '../components/StudentIndicators';
import { Toast } from '../components/Toast';
import { useMe } from '../lib/auth';
import { buildShareUrl, useStudents } from '../lib/students';

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Dashboard surfaces the first page of students; deeper paging lives on /students.
  const list = useStudents({ page: 1, limit: 6 });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  if (me.isLoading) {
    return (
      <div data-testid="dashboard-loading" className="text-sm text-ink-muted">
        {t('common.loading')}
      </div>
    );
  }
  if (!me.data) return null;

  const displayName = me.data.name ?? me.data.email.split('@')[0] ?? '';

  const onCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token));
      setToast(t('dashboard.toast.inviteCopied'));
    } catch {
      setToast(t('dashboard.toast.inviteCopyFailed'));
    }
  };

  return (
    <section data-testid="dashboard" className="space-y-6">
      <OfflineBanner />
      <InstallPrompt />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {t('dashboard.welcomeName', { name: displayName }) as string}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{t('dashboard.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
          data-testid="dashboard-add-student"
        >
          <Plus size={16} aria-hidden /> {t('students.add.button')}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label={t('dashboard.kpi.activeStudents')} value={String(total)} Icon={Users} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{t('dashboard.studentsTitle')}</h2>
          {total > items.length && (
            <Link
              to="/students"
              className="text-sm font-medium text-brand-700 hover:underline"
              data-testid="dashboard-view-all-students"
            >
              {t('dashboard.viewAllStudents')}
            </Link>
          )}
        </div>

        {list.isLoading && (
          <p data-testid="dashboard-students-loading" className="text-sm text-ink-muted">
            {t('common.loading')}
          </p>
        )}

        {!list.isLoading && items.length === 0 && (
          <div
            data-testid="dashboard-students-empty"
            className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center"
          >
            <Users size={28} aria-hidden className="mx-auto text-ink-subtle" />
            <p className="mt-3 text-sm text-ink-muted">{t('dashboard.emptyStudents')}</p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              <Plus size={14} aria-hidden /> {t('students.add.button')}
            </button>
          </div>
        )}

        {items.length > 0 && (
          <ul
            data-testid="dashboard-students-grid"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {items.map((s) => (
              <StudentCard key={s.id} student={s} onCopyInvite={() => void onCopy(s.shareToken)} />
            ))}
          </ul>
        )}
      </section>

      <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="dashboard-toast" />}
    </section>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  Icon: typeof Users;
}

function KpiCard({ label, value, Icon }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-50 text-brand-600">
          <Icon size={16} aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
    </div>
  );
}

interface StudentCardProps {
  student: StudentListItem;
  onCopyInvite: () => void;
}

function StudentCard({ student, onCopyInvite }: StudentCardProps) {
  const { t } = useTranslation();
  const initials = initialsFor(student.name);
  const everActive = wasEverActive(student.summary);
  return (
    <li className="relative">
      <Link
        to="/students/$id"
        params={{ id: student.id }}
        data-testid={`dashboard-student-${student.id}`}
        className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-brand-300 focus:border-brand-500 focus:outline-none"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-semibold text-ink"
              data-testid={`dashboard-student-name-${student.id}`}
            >
              <Bidi>{student.name}</Bidi>
            </p>
            {student.nativeLanguage && (
              <p className="mt-0.5 text-xs text-ink-subtle">
                {t('students.row.l1', { code: student.nativeLanguage.toUpperCase() })}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1">
          <StudentIndicators summary={student.summary} compact />
        </div>

        {!everActive && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCopyInvite();
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-50 px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
            data-testid={`dashboard-student-invite-${student.id}`}
          >
            <LinkIcon size={12} aria-hidden />
            {t('students.actions.invite')}
          </button>
        )}
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
