import { Link, useNavigate } from '@tanstack/react-router';
import type { CalendarItem } from '@tutor-app/shared';
import { CalendarClock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddLessonModal } from '../components/AddLessonModal';
import { Bidi } from '../components/Bidi';
import { StudentPickerModal } from '../components/StudentPickerModal';
import { Button, EmptyState } from '../components/ui';
import { useCalendar } from '../lib/lessons';

/**
 * /schedule
 *
 * Chronological list of recorded lessons (manual or attached-from-Google).
 * The session *time* leads each row — it's the sort key — and upcoming
 * sessions are grouped by day so a tutor can scan their week. Past rows flag
 * lessons that still need a feedback write-up.
 *
 * Google-only events are intentionally hidden here; attaching them is a
 * later pass.
 */
export function SchedulePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.resolvedLanguage ?? 'en';

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 90 * 86_400_000);
    const to = new Date(now.getTime() + 60 * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const data = useCalendar(range);

  // Only lessons the tutor has actually added; Google-only events are excluded.
  const lessons: CalendarItem[] = useMemo(() => {
    if (!data.data) return [];
    return data.data.items.filter((i) => i.hasLocalLesson && !!i.localLessonId);
  }, [data.data]);

  const { upcomingByDay, past } = useMemo(() => groupSchedule(lessons, locale), [lessons, locale]);

  // Add-lesson flow: pick a student, then open the lesson modal for them.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);

  return (
    <section data-testid="schedule-page" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('schedule.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('schedule.subtitle')}</p>
        </div>
        <Button onClick={() => setPickerOpen(true)} data-testid="schedule-add-link">
          {t('schedule.addCta')}
        </Button>
      </header>

      {data.isLoading && (
        <p data-testid="schedule-loading" className="text-sm text-ink-muted">
          {t('common.loading')}
        </p>
      )}

      {data.isError && (
        <p
          role="alert"
          data-testid="schedule-error"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {t('schedule.loadError')}
        </p>
      )}

      {data.data && lessons.length === 0 && (
        <EmptyState
          Icon={CalendarClock}
          message={t('schedule.empty')}
          testId="schedule-empty"
          action={
            <Button onClick={() => setPickerOpen(true)}>{t('schedule.addCta')}</Button>
          }
        />
      )}

      {upcomingByDay.map((day) => (
        <ScheduleGroup key={day.label} label={day.label} testId="upcoming">
          {day.items.map((item) => (
            <ScheduleRow key={item.localLessonId} item={item} locale={locale} />
          ))}
        </ScheduleGroup>
      ))}

      {past.length > 0 && (
        <ScheduleGroup label={t('schedule.groups.past')} testId="past">
          {past.map((item) => (
            <ScheduleRow key={item.localLessonId} item={item} locale={locale} withDate />
          ))}
        </ScheduleGroup>
      )}

      <StudentPickerModal
        open={pickerOpen}
        contextLabel={t('schedule.addCta')}
        onClose={() => setPickerOpen(false)}
        onPicked={(studentId) => {
          setPickerOpen(false);
          setPendingStudentId(studentId);
        }}
      />
      <AddLessonModal
        open={!!pendingStudentId}
        studentId={pendingStudentId ?? ''}
        onClose={() => setPendingStudentId(null)}
        onCreated={(lessonId) => {
          setPendingStudentId(null);
          void navigate({ to: '/lessons/$id', params: { id: lessonId } });
        }}
      />
    </section>
  );
}

interface ScheduleGroupProps {
  label: string;
  testId: string;
  children: React.ReactNode;
}

function ScheduleGroup({ label, testId, children }: ScheduleGroupProps) {
  return (
    <section className="space-y-2" data-testid={`schedule-group-${testId}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{label}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {children}
      </ul>
    </section>
  );
}

interface ScheduleRowProps {
  item: CalendarItem;
  locale: string;
  /** Show the date next to the time (used in the flat "Past" group). */
  withDate?: boolean;
}

/** A schedule row — the time leads, the student is the strong secondary. */
export function ScheduleRow({ item, locale, withDate }: ScheduleRowProps) {
  const { t } = useTranslation();
  const id = item.localLessonId!;
  const date = new Date(item.startsAt);
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const isPast = date.getTime() < Date.now();
  const needsFeedback = isPast && !item.hasFeedback;

  return (
    <li>
      <Link
        to="/lessons/$id"
        params={{ id }}
        data-testid={`schedule-lesson-${id}`}
        className="flex items-center gap-4 px-4 py-3 hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
      >
        <div className="w-20 shrink-0 text-center">
          {withDate && <div className="text-xs text-ink-subtle">{dayFmt.format(date)}</div>}
          <div className="text-base font-semibold tabular-nums text-ink">
            {timeFmt.format(date)}
          </div>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initialsFor(item.studentName ?? item.title)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            <Bidi>{item.studentName ?? item.title}</Bidi>
          </p>
          {item.studentName && item.title && item.title !== item.studentName && (
            <p className="truncate text-xs text-ink-subtle">
              <Bidi>{item.title}</Bidi>
            </p>
          )}
        </div>
        {needsFeedback && (
          <span
            data-testid={`schedule-needs-feedback-${id}`}
            className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
          >
            {t('schedule.needsFeedback')}
          </span>
        )}
      </Link>
    </li>
  );
}

interface DayGroup {
  label: string;
  items: CalendarItem[];
}

/** Upcoming sessions bucketed by day (Today / Tomorrow / weekday); past flat. */
function groupSchedule(
  items: CalendarItem[],
  locale: string,
): { upcomingByDay: DayGroup[]; past: CalendarItem[] } {
  const now = Date.now();
  const upcoming: CalendarItem[] = [];
  const past: CalendarItem[] = [];
  for (const item of items) {
    if (new Date(item.startsAt).getTime() >= now) upcoming.push(item);
    else past.push(item);
  }
  upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  const byDay: DayGroup[] = [];
  for (const item of upcoming) {
    const label = relativeDayLabel(new Date(item.startsAt), locale);
    const last = byDay[byDay.length - 1];
    if (last && last.label === label) last.items.push(item);
    else byDay.push({ label, items: [item] });
  }
  return { upcomingByDay: byDay, past };
}

function relativeDayLabel(date: Date, locale: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0 || diffDays === 1) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return capitalize(rtf.format(diffDays, 'day'));
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

function initialsFor(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '–';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '–').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}
