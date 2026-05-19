import { Link } from '@tanstack/react-router';
import type { CalendarItem } from '@tutor-app/shared';
import { CalendarClock, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { useCalendar } from '../lib/lessons';

/**
 * /schedule
 *
 * Chronological list of recorded lessons (manual or attached-from-Google).
 * Replaces the FullCalendar grid — tutors keep their actual day calendar in
 * Google, and this view exists only to surface the sessions they teach in
 * this app, with the *student* as the dominant attribute (not the time).
 *
 * Google-only events are intentionally hidden here; the "attach an event as
 * a lesson" flow is deferred to a later pass.
 */
export function SchedulePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';

  // Wide window so "past" can scroll meaningfully without a paginate-back UI.
  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 90 * 86_400_000);
    const to = new Date(now.getTime() + 60 * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const data = useCalendar(range);

  // Only lessons the tutor has actually added (manual or attached from Google).
  // Google-only events aren't part of "scheduled" until they're attached.
  const lessons: CalendarItem[] = useMemo(() => {
    if (!data.data) return [];
    return data.data.items.filter((i) => i.hasLocalLesson && !!i.localLessonId);
  }, [data.data]);

  const groups = useMemo(() => groupByPeriod(lessons), [lessons]);

  return (
    <section data-testid="schedule-page" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('schedule.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('schedule.subtitle')}</p>
        </div>
        <Link
          to="/students"
          className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
          data-testid="schedule-add-link"
        >
          <Plus size={16} aria-hidden /> {t('schedule.addCta')}
        </Link>
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
        <div
          data-testid="schedule-empty"
          className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center"
        >
          <CalendarClock size={28} aria-hidden className="mx-auto text-ink-subtle" />
          <p className="mt-3 text-sm text-ink-muted">{t('schedule.empty')}</p>
          <Link
            to="/students"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            <Plus size={14} aria-hidden /> {t('schedule.addCta')}
          </Link>
        </div>
      )}

      {groups.upcoming.length > 0 && (
        <GroupSection title={t('schedule.groups.upcoming')} items={groups.upcoming} locale={locale} />
      )}
      {groups.past.length > 0 && (
        <GroupSection title={t('schedule.groups.past')} items={groups.past} locale={locale} pastTense />
      )}
    </section>
  );
}

interface GroupSectionProps {
  title: string;
  items: CalendarItem[];
  locale: string;
  pastTense?: boolean;
}

function GroupSection({ title, items, locale, pastTense }: GroupSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" data-testid={`schedule-group-${pastTense ? 'past' : 'upcoming'}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {items.map((item) => {
          const id = item.localLessonId!;
          return (
            <li key={id} className="relative">
              <Link
                to="/lessons/$id"
                params={{ id }}
                data-testid={`schedule-lesson-${id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
                  {initialsFor(item.studentName ?? item.title)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink">
                    <Bidi>{item.studentName ?? item.title}</Bidi>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {formatWhen(new Date(item.startsAt), locale)}
                    {item.studentName && item.title && item.title !== item.studentName && (
                      <>
                        {' · '}
                        <span className="text-ink-subtle">
                          <Bidi>{item.title}</Bidi>
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <span className="text-xs font-medium text-brand-700">{t('schedule.open')}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface GroupedItems {
  upcoming: CalendarItem[];
  past: CalendarItem[];
}

function groupByPeriod(items: CalendarItem[]): GroupedItems {
  const now = Date.now();
  const upcoming: CalendarItem[] = [];
  const past: CalendarItem[] = [];
  for (const item of items) {
    if (new Date(item.startsAt).getTime() >= now) upcoming.push(item);
    else past.push(item);
  }
  upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  return { upcoming, past };
}

/** "Today · 3:00 PM" / "Tomorrow · 10:00 AM" / "Mar 12 · 4:00 PM" */
function formatWhen(date: Date, locale: string): string {
  const dayLabel = relativeDayLabel(date, locale);
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel} · ${timeFmt.format(date)}`;
}

function relativeDayLabel(date: Date, locale: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (diffDays === 0 || diffDays === 1 || diffDays === -1) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return capitalize(rtf.format(diffDays, 'day'));
  }
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  return fmt.format(date);
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
