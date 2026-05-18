import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { FeedbackEditor } from '../components/FeedbackEditor';
import { GamesPanel } from '../components/GamesPanel';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { useLesson } from '../lib/lessons';

/**
 * /lessons/:id — Phase 4 lesson detail page (extended in Phase 5).
 *
 * Top: lesson metadata (date, student, source).
 * Middle: feedback editor with a TEXT / VOICE toggle. Voice tab records
 *         audio in-browser, uploads it, transcribes via Whisper, and
 *         pre-fills the text feedback editor with the suggested transcript.
 *         The tutor still has to click "Save" to commit.
 * Bottom: games panel — list + Generate Fill-Blank / Generate Timed Quiz,
 *         opens the question review modal on click.
 */
export function LessonDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ from: '/lessons/$id' });
  const id = params.id;
  const detail = useLesson(id);
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<'text' | 'voice'>('text');

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
  // When the transcript landed but the tutor hasn't saved yet, hint that
  // the editor is showing a suggestion.
  const transcribedNotSaved =
    lesson.transcriptionStatus === 'DONE' && hasFeedback && lesson.feedbackSource !== 'VOICE';

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

      {/* TEXT / VOICE feedback mode toggle */}
      <div
        role="tablist"
        aria-label={t('feedback.modeLabel')}
        data-testid="feedback-mode-toggle"
        className="inline-flex rounded border border-slate-300 bg-white text-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={feedbackMode === 'text'}
          onClick={() => setFeedbackMode('text')}
          data-testid="feedback-mode-text"
          className={
            feedbackMode === 'text'
              ? 'rounded-s px-3 py-1.5 font-medium bg-slate-900 text-white'
              : 'rounded-s px-3 py-1.5 text-slate-700 hover:bg-slate-50'
          }
        >
          {t('feedback.modeText')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={feedbackMode === 'voice'}
          onClick={() => setFeedbackMode('voice')}
          data-testid="feedback-mode-voice"
          className={
            feedbackMode === 'voice'
              ? 'rounded-e px-3 py-1.5 font-medium bg-slate-900 text-white'
              : 'rounded-e px-3 py-1.5 text-slate-700 hover:bg-slate-50'
          }
        >
          {t('feedback.modeVoice')}
        </button>
      </div>

      {feedbackMode === 'voice' && (
        <VoiceRecorder
          lessonId={lesson.id}
          initialStatus={lesson.transcriptionStatus}
          initialError={lesson.transcriptionError}
          disabled={feedbackDirty}
          onTranscriptionDone={() => {
            // Pull the new feedbackText into the editor + nudge the tutor
            // to switch back to the text tab to review/save.
            void qc.invalidateQueries({ queryKey: ['lesson', lesson.id] });
            setFeedbackMode('text');
          }}
        />
      )}

      {feedbackMode === 'text' && transcribedNotSaved && (
        <p
          data-testid="feedback-transcribed-hint"
          className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900"
        >
          {t('feedback.transcribedHint')}
        </p>
      )}

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
