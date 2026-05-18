import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddLessonModal } from '../components/AddLessonModal';
import { Bidi } from '../components/Bidi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProgressOverview } from '../components/ProgressOverview';
import { RecentAttemptsList } from '../components/RecentAttemptsList';
import { Toast } from '../components/Toast';
import { api } from '../lib/api';
import { useLessonsForStudent } from '../lib/lessons';
import { useStudentAttempts, useStudentProgress } from '../lib/progress';
import { buildShareUrl, useStudent } from '../lib/students';

const ATTEMPTS_PAGE_SIZE = 10;

export function StudentDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ from: '/students/$id' });
  const id = params.id;
  const qc = useQueryClient();

  const detail = useStudent(id);
  const lessons = useLessonsForStudent(id ? { studentId: id, page: 1, limit: 10 } : null);
  const progress = useStudentProgress(id);
  const [attemptsPage, setAttemptsPage] = useState(1);
  const attempts = useStudentAttempts(id, attemptsPage, ATTEMPTS_PAGE_SIZE);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addLessonOpen, setAddLessonOpen] = useState(false);

  useEffect(() => {
    if (detail.data && !editing) {
      setName(detail.data.name);
      setNotes(detail.data.notes ?? '');
    }
  }, [detail.data, editing]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateStudent(id, {
        name: name.trim() || undefined,
        notes: notes.trim() === '' ? null : notes.trim(),
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(['student', id], updated);
      await qc.invalidateQueries({ queryKey: ['students'] });
      setEditing(false);
      setToast(t('students.toast.saved'));
    },
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.rotateStudentToken(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['student', id] });
      await qc.invalidateQueries({ queryKey: ['students'] });
      setRotateOpen(false);
      setToast(t('students.toast.tokenRotated'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteStudent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      void navigate({ to: '/students' });
    },
  });

  const onCopyShare = async () => {
    if (!detail.data) return;
    try {
      await navigator.clipboard.writeText(buildShareUrl(detail.data.shareToken));
      setToast(t('students.toast.linkCopied'));
    } catch {
      setToast(t('students.toast.linkCopyFailed'));
    }
  };

  if (detail.isLoading) {
    return (
      <p data-testid="student-detail-loading" className="text-sm text-slate-600">
        {t('common.loading')}
      </p>
    );
  }

  if (!detail.data) {
    return (
      <div
        data-testid="student-not-found"
        className="rounded-lg border border-slate-200 bg-white p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('students.detail.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('students.detail.notFoundBody')}</p>
        <Link
          to="/students"
          className="mt-4 inline-block text-sm font-medium underline"
          data-testid="student-back-from-missing"
        >
          {t('students.detail.back')}
        </Link>
      </div>
    );
  }

  const student = detail.data;

  return (
    <section data-testid="student-detail" className="space-y-6">
      <Link
        to="/students"
        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
        data-testid="student-back"
      >
        {t('students.detail.back')}
      </Link>

      <header>
        <h1 className="text-2xl font-semibold">
          <Bidi>{student.name}</Bidi>
        </h1>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="rounded-lg border border-slate-200 bg-white p-6"
      >
        <h2 className="text-lg font-semibold">{t('students.detail.profileTitle')}</h2>

        <label htmlFor="student-name" className="mt-4 block text-sm font-medium">
          {t('students.fields.name')}
        </label>
        <input
          id="student-name"
          type="text"
          dir="auto"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setEditing(true);
          }}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="student-name-input"
        />

        <label htmlFor="student-notes" className="mt-4 block text-sm font-medium">
          {t('students.fields.notes')}
        </label>
        <textarea
          id="student-notes"
          dir="auto"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setEditing(true);
          }}
          rows={4}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          data-testid="student-notes-input"
        />

        <div className="mt-6 flex items-center gap-2">
          <button
            type="submit"
            disabled={!editing || saveMutation.isPending}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="student-save"
          >
            {saveMutation.isPending ? t('common.workingOn') : t('students.detail.save')}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(student.name);
                setNotes(student.notes ?? '');
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              data-testid="student-cancel-edit"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">{t('students.detail.shareTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('students.detail.shareBody')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code
            dir="ltr"
            data-testid="student-share-url"
            className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded bg-slate-100 px-2 py-1 text-xs"
          >
            {buildShareUrl(student.shareToken)}
          </code>
          <button
            type="button"
            onClick={onCopyShare}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            data-testid="student-copy-share"
          >
            {t('students.actions.copyShare')}
          </button>
          <button
            type="button"
            onClick={() => setRotateOpen(true)}
            className="rounded border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50"
            data-testid="student-rotate-token"
          >
            {t('students.actions.rotateToken')}
          </button>
        </div>
      </div>

      <section data-testid="student-progress-section" className="space-y-6">
        <h2 className="text-lg font-semibold">{t('progress.title')}</h2>
        {progress.isLoading ? (
          <p className="text-sm text-slate-600">{t('common.loading')}</p>
        ) : progress.error ? (
          <div
            data-testid="student-progress-error"
            className="rounded border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-900"
          >
            {t('progress.error')}
          </div>
        ) : progress.data ? (
          <ProgressOverview
            data={progress.data}
            rtl={(i18n.dir(i18n.resolvedLanguage) === 'rtl')}
            locale={i18n.resolvedLanguage ?? 'en'}
          />
        ) : null}

        <div data-testid="student-attempts-section" className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            {t('progress.attempts.title')}
          </h3>
          {attempts.isLoading ? (
            <p className="text-sm text-slate-600">{t('common.loading')}</p>
          ) : attempts.error ? (
            <div
              data-testid="student-attempts-error"
              className="rounded border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-900"
            >
              {t('progress.error')}
            </div>
          ) : attempts.data ? (
            <RecentAttemptsList
              data={attempts.data}
              locale={i18n.resolvedLanguage ?? 'en'}
              page={attemptsPage}
              onPageChange={setAttemptsPage}
            />
          ) : null}
        </div>
      </section>

      <div className="rounded-lg border border-slate-200 bg-white p-6" data-testid="student-lessons">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('lessons.recent.title')}</h2>
          <button
            type="button"
            onClick={() => setAddLessonOpen(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            data-testid="student-add-lesson"
          >
            {t('lessons.manualAdd.button')}
          </button>
        </div>

        {lessons.isLoading && (
          <p className="mt-4 text-sm text-slate-600">{t('common.loading')}</p>
        )}

        {!lessons.isLoading && lessons.data && lessons.data.items.length === 0 && (
          <p
            data-testid="student-lessons-empty"
            className="mt-4 rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-600"
          >
            {t('lessons.recent.empty')}
          </p>
        )}

        {lessons.data && lessons.data.items.length > 0 && (
          <ul
            data-testid="student-lessons-list"
            className="mt-4 divide-y divide-slate-200 rounded border border-slate-200"
          >
            {lessons.data.items.map((l) => {
              const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
                dateStyle: 'medium',
                timeStyle: 'short',
              });
              return (
                <li
                  key={l.id}
                  data-testid={`student-lesson-row-${l.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {l.title ? <Bidi>{l.title}</Bidi> : dateFmt.format(new Date(l.occurredAt))}
                    </p>
                    {l.title && (
                      <p className="text-xs text-slate-500">{dateFmt.format(new Date(l.occurredAt))}</p>
                    )}
                  </div>
                  <Link
                    to="/lessons/$id"
                    params={{ id: l.id }}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                    data-testid={`student-lesson-open-${l.id}`}
                  >
                    {t('lessons.recent.open')}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-semibold text-rose-900">{t('students.delete.title')}</h2>
        <p className="mt-1 text-sm text-rose-900">{t('students.delete.warningGeneric')}</p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="mt-4 rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white"
          data-testid="student-delete"
        >
          {t('students.delete.button')}
        </button>
      </div>

      <ConfirmDialog
        open={rotateOpen}
        testId="rotate-confirm"
        title={t('students.rotate.title')}
        body={t('students.rotate.warning')}
        confirmLabel={t('students.rotate.button')}
        busy={rotateMutation.isPending}
        onConfirm={() => rotateMutation.mutate()}
        onCancel={() => setRotateOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        destructive
        testId="delete-confirm"
        title={t('students.delete.title')}
        body={
          <p>
            {t('students.delete.warning')} <Bidi>{student.name}</Bidi>
          </p>
        }
        expectedConfirmText={student.name}
        confirmInputLabel={t('students.delete.confirmLabel', { name: student.name })}
        confirmLabel={t('students.delete.button')}
        busy={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />

      <AddLessonModal
        open={addLessonOpen}
        studentId={id}
        onClose={() => setAddLessonOpen(false)}
        onCreated={(lessonId) => {
          void navigate({ to: '/lessons/$id', params: { id: lessonId } });
        }}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="student-toast" />}
    </section>
  );
}
