import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bidi } from '../components/Bidi';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { FeedbackEditor } from '../components/FeedbackEditor';
import { GamesPanel } from '../components/GamesPanel';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { Card, CardBody } from '../components/ui';
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
      <p data-testid="lesson-detail-loading" className="text-sm text-ink-muted">
        {t('common.loading')}
      </p>
    );
  }

  if (!detail.data) {
    return (
      <div
        data-testid="lesson-not-found"
        className="rounded-lg border border-line bg-surface p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('lessons.detail.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('lessons.detail.notFoundBody')}</p>
        <button
          type="button"
          onClick={() => navigate({ to: '/schedule' })}
          className="mt-4 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-muted"
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

  const lessonLabel = lesson.title
    ? lesson.title
    : t('lessons.detail.occurredAt', { date: dateFmt.format(new Date(lesson.occurredAt)) });

  return (
    <section data-testid="lesson-detail" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: t('nav.students'), to: '/students' },
          ...(lesson.studentName
            ? [
                {
                  label: <Bidi>{lesson.studentName}</Bidi>,
                  to: '/students/$id' as const,
                  params: { id: lesson.studentId },
                },
              ]
            : []),
          { label: <Bidi>{lessonLabel}</Bidi>, current: true as const },
        ]}
      />

      {/* Header card — student is the prominent attribute, source a quiet chip. */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">
              <Bidi>{lessonLabel}</Bidi>
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
              {lesson.studentName && (
                <Link
                  to="/students/$id"
                  params={{ id: lesson.studentId }}
                  className="font-medium text-brand-700 hover:underline"
                  data-testid="lesson-detail-student"
                >
                  <Bidi>{lesson.studentName}</Bidi>
                </Link>
              )}
              {lesson.studentName && <span aria-hidden>·</span>}
              <span>{dateFmt.format(new Date(lesson.occurredAt))}</span>
            </p>
          </div>
          <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted">
            {lesson.source === 'GOOGLE_CALENDAR'
              ? t('lessons.detail.sourceGoogle')
              : t('lessons.detail.sourceManual')}
          </span>
        </CardBody>
      </Card>

      {/* Feedback workbench — Text + Voice swap IN PLACE in one slot, so
          toggling never reflows the page (the old jump). Both stay mounted;
          only visibility toggles, which also preserves recording state. */}
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label={t('feedback.modeLabel')}
          data-testid="feedback-mode-toggle"
          className="inline-flex overflow-hidden rounded-md border border-line-strong text-sm"
        >
          <button
            type="button"
            role="tab"
            aria-selected={feedbackMode === 'text'}
            onClick={() => setFeedbackMode('text')}
            data-testid="feedback-mode-text"
            className={
              feedbackMode === 'text'
                ? 'bg-brand-500 px-3 py-1.5 font-medium text-white'
                : 'px-3 py-1.5 text-ink-muted hover:bg-surface-sunken'
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
                ? 'bg-brand-500 px-3 py-1.5 font-medium text-white'
                : 'px-3 py-1.5 text-ink-muted hover:bg-surface-sunken'
            }
          >
            {t('feedback.modeVoice')}
          </button>
        </div>

        <div className={feedbackMode === 'text' ? 'space-y-4' : 'hidden'}>
          {transcribedNotSaved && (
            <p
              data-testid="feedback-transcribed-hint"
              className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900"
            >
              {t('feedback.transcribedHint')}
            </p>
          )}
          <FeedbackEditor
            lessonId={lesson.id}
            initialFeedback={lesson.feedbackText ?? ''}
            onDirtyChange={setFeedbackDirty}
          />
        </div>

        <div className={feedbackMode === 'voice' ? '' : 'hidden'}>
          <VoiceRecorder
            lessonId={lesson.id}
            initialStatus={lesson.transcriptionStatus}
            initialError={lesson.transcriptionError}
            disabled={feedbackDirty}
            onTranscriptionDone={() => {
              void qc.invalidateQueries({ queryKey: ['lesson', lesson.id] });
              setFeedbackMode('text');
            }}
          />
        </div>
      </div>

      <GamesPanel
        lessonId={lesson.id}
        canGenerate={hasFeedback}
        hasUnsavedFeedback={feedbackDirty}
      />
    </section>
  );
}
