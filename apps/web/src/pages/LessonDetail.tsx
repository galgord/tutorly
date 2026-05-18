import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { FeedbackEditor } from '../components/FeedbackEditor';
import { GamesPanel } from '../components/GamesPanel';
import { useLesson } from '../lib/lessons';

/**
 * /lessons/:id — Phase 4 lesson detail page.
 *
 * Top: lesson metadata (date, student, source).
 * Middle: feedback editor — once saved, unlocks game generation.
 * Bottom: games panel — list + Generate Fill-Blank / Generate Timed Quiz,
 *         opens the question review modal on click.
 */
export function LessonDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ from: '/lessons/$id' });
  const id = params.id;
  const detail = useLesson(id);
  const [feedbackDirty, setFeedbackDirty] = useState(false);

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
  const hasFeedback = !!lesson.feedbackText && lesson.feedbackText.trim().length > 0;

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
            <dt className="font-medium">{t('lessons.detail.dateLabel')}</dt>
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

      <FeedbackEditor
        lessonId={lesson.id}
        initialFeedback={lesson.feedbackText ?? ''}
        onDirtyChange={setFeedbackDirty}
      />

      <GamesPanel
        lessonId={lesson.id}
        canGenerate={hasFeedback}
        hasUnsavedFeedback={feedbackDirty}
      />
    </section>
  );
}
