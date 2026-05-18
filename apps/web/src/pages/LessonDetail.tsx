import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { useLesson } from '../lib/lessons';

/**
 * /lessons/:id — Phase 3 placeholder
 *
 * Shows the lesson's date, title, student name, and a "Feedback coming in
 * Phase 4" empty state. This page exists so that calendar / student-page
 * links work today. The actual feedback editor (transcript field, generate
 * game CTAs, etc.) lands in Phase 4.
 */
export function LessonDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ from: '/lessons/$id' });
  const id = params.id;
  const detail = useLesson(id);

  if (detail.isLoading) {
    return (
      <p data-testid="lesson-detail-loading" className="text-sm text-slate-600">
        {t('common.loading')}
      </p>
    );
  }

  if (!detail.data) {
    return (
      <div
        data-testid="lesson-not-found"
        className="rounded-lg border border-slate-200 bg-white p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('lessons.detail.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('lessons.detail.notFoundBody')}</p>
        <button
          type="button"
          onClick={() => navigate({ to: '/calendar' })}
          className="mt-4 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          {t('lessons.detail.back')}
        </button>
      </div>
    );
  }

  const lesson = detail.data;
  const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <section data-testid="lesson-detail" className="space-y-6">
      <Link
        to="/calendar"
        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
        data-testid="lesson-detail-back"
      >
        {t('lessons.detail.back')}
      </Link>

      <header>
        <h1 className="text-2xl font-semibold">
          {lesson.title ? <Bidi>{lesson.title}</Bidi> : t('lessons.detail.occurredAt', {
            date: dateFmt.format(new Date(lesson.occurredAt)),
          })}
        </h1>
        <dl className="mt-2 grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="font-medium">{t('lessons.detail.occurredAt', { date: '' }).replace(/[\s.]+$/, '')}</dt>
            <dd>{dateFmt.format(new Date(lesson.occurredAt))}</dd>
          </div>
          {lesson.studentName && (
            <div className="flex gap-2">
              <dt className="font-medium">{t('lessons.detail.studentLabel')}</dt>
              <dd>
                <Link
                  to="/students/$id"
                  params={{ id: lesson.studentId }}
                  className="underline-offset-2 hover:underline"
                  data-testid="lesson-detail-student"
                >
                  <Bidi>{lesson.studentName}</Bidi>
                </Link>
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="font-medium">{t('lessons.detail.sourceLabel')}</dt>
            <dd>
              {lesson.source === 'GOOGLE_CALENDAR'
                ? t('lessons.detail.sourceGoogle')
                : t('lessons.detail.sourceManual')}
            </dd>
          </div>
        </dl>
      </header>

      <div
        data-testid="lesson-feedback-placeholder"
        className="rounded-lg border border-dashed border-slate-300 bg-white p-6"
      >
        <h2 className="text-lg font-semibold">{t('lessons.detail.feedbackPlaceholderTitle')}</h2>
        <p className="mt-2 text-sm text-slate-600">{t('lessons.detail.feedbackPlaceholderBody')}</p>
      </div>
    </section>
  );
}
