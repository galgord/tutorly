import { Link, useNavigate } from '@tanstack/react-router';
import type { CalendarItem, StudentListItem } from '@tutor-app/shared';
import { CalendarClock, Gamepad2, Link as LinkIcon, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddStudentModal } from '../components/AddStudentModal';
import { Bidi } from '../components/Bidi';
import { GettingStartedPanel } from '../components/GettingStartedPanel';
import { InstallPrompt } from '../components/InstallPrompt';
import { OfflineBanner } from '../components/OfflineBanner';
import { StudentIndicators, wasEverActive } from '../components/StudentIndicators';
import { TeachingSetupModal } from '../components/TeachingSetupModal';
import { Toast } from '../components/Toast';
import { EmptyState, Skeleton, StatTile } from '../components/ui';
import { ScheduleRow } from './Schedule';
import { useMe } from '../lib/auth';
import { useCalendar } from '../lib/lessons';
import { buildShareUrl, useStudents } from '../lib/students';

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const navigate = useNavigate();
  const me = useMe();
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // First-run teaching setup: dismissed flag lets a tutor skip without it
  // reappearing for the rest of the session.
  const [setupDismissed, setSetupDismissed] = useState(false);

  // Dashboard surfaces the first page of students; deeper paging lives on /students.
  const list = useStudents({ page: 1, limit: 6 });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  // A wider page powers the "games assigned" aggregate without a new endpoint.
  const allStudents = useStudents({ page: 1, limit: 100 });
  const gamesAssigned = useMemo(
    () => (allStudents.data?.items ?? []).reduce((sum, s) => sum + s.summary.assignedGamesCount, 0),
    [allStudents.data],
  );

  // Calendar for the current local week — drives both the KPI and the
  // "Today's lessons" section. The range covers this week through end of day.
  const weekRange = useMemo(() => weekBounds(), []);
  const calendar = useCalendar(weekRange);
  const localLessons: CalendarItem[] = useMemo(
    () => (calendar.data?.items ?? []).filter((i) => i.hasLocalLesson && !!i.localLessonId),
    [calendar.data],
  );
  const lessonsThisWeek = useMemo(() => {
    const { weekStart, weekEnd } = weekRangeMs();
    return localLessons.filter((i) => {
      const ms = new Date(i.startsAt).getTime();
      return ms >= weekStart && ms < weekEnd;
    }).length;
  }, [localLessons]);
  const todaysLessons = useMemo(() => {
    const { dayStart, dayEnd } = todayRangeMs();
    return localLessons
      .filter((i) => {
        const ms = new Date(i.startsAt).getTime();
        return ms >= dayStart && ms < dayEnd;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [localLessons]);

  if (me.isLoading) {
    return (
      <div data-testid="dashboard-loading" className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }
  if (!me.data) return null;

  const displayName = me.data.name ?? me.data.email.split('@')[0] ?? '';
  const needsTeachingSetup = me.data.subject == null && !setupDismissed;

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

      <div
        data-testid="dashboard-kpis"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <StatTile
          label={t('dashboard.kpi.activeStudents')}
          value={String(total)}
          Icon={Users}
          testId="dashboard-kpi-students"
        />
        <StatTile
          label={t('dashboard.kpi.lessonsThisWeek')}
          value={calendar.isLoading ? '–' : String(lessonsThisWeek)}
          Icon={CalendarClock}
          testId="dashboard-kpi-lessons"
        />
        <StatTile
          label={t('dashboard.kpi.gamesAssigned')}
          value={allStudents.isLoading ? '–' : String(gamesAssigned)}
          Icon={Gamepad2}
          testId="dashboard-kpi-games"
        />
      </div>

      <section className="space-y-3" data-testid="dashboard-today">
        <h2 className="text-lg font-semibold text-ink">{t('dashboard.todayTitle')}</h2>
        {calendar.isLoading && <Skeleton className="h-16 w-full" />}
        {!calendar.isLoading && todaysLessons.length === 0 && (
          <EmptyState
            Icon={CalendarClock}
            message={t('dashboard.todayEmpty')}
            testId="dashboard-today-empty"
          />
        )}
        {!calendar.isLoading && todaysLessons.length > 0 && (
          <ul
            data-testid="dashboard-today-list"
            className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
          >
            {todaysLessons.map((item) => (
              <ScheduleRow key={item.localLessonId} item={item} locale={locale} />
            ))}
          </ul>
        )}
      </section>

      {list.isLoading && (
        <div data-testid="dashboard-students-loading" className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      )}

      {!list.isLoading && items.length === 0 && (
        <div data-testid="dashboard-students-empty">
          <GettingStartedPanel onAddStudent={() => setAddOpen(true)} />
        </div>
      )}

      {items.length > 0 && (
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

          <ul
            data-testid="dashboard-students-grid"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {items.map((s) => (
              <StudentCard key={s.id} student={s} onCopyInvite={() => void onCopy(s.shareToken)} />
            ))}
          </ul>
        </section>
      )}

      <AddStudentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(student) => void navigate({ to: '/students/$id', params: { id: student.id } })}
      />
      <TeachingSetupModal open={needsTeachingSetup} onClose={() => setSetupDismissed(true)} />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="dashboard-toast" />}
    </section>
  );
}

/** Local-time millisecond bounds for the current week (Mon 00:00 → next Mon 00:00). */
function weekRangeMs(): { weekStart: number; weekEnd: number } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday … 6 = Saturday. Treat Monday as the week start.
  const dayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { weekStart: start.getTime(), weekEnd: end.getTime() };
}

/** Local-time millisecond bounds for today (00:00 → next 00:00). */
function todayRangeMs(): { dayStart: number; dayEnd: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStart: start.getTime(), dayEnd: end.getTime() };
}

/** ISO range for the calendar fetch — the full current week. */
function weekBounds(): { from: string; to: string } {
  const { weekStart, weekEnd } = weekRangeMs();
  return { from: new Date(weekStart).toISOString(), to: new Date(weekEnd).toISOString() };
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
