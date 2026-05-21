import { Link, useNavigate, useParams } from '@tanstack/react-router';
import type { StudentGameSummary } from '@tutor-app/shared';
import { ClipboardList, GraduationCap, Pencil, Plus, Share2, Target } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddLessonModal } from '../components/AddLessonModal';
import { Bidi } from '../components/Bidi';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { GamePreviewDialog } from '../components/GamePreviewDialog';
import { GameProgressPanel } from '../components/GameProgressPanel';
import { ProgressOverview } from '../components/ProgressOverview';
import { RecentAttemptsList } from '../components/RecentAttemptsList';
import { StudentEditModal } from '../components/StudentEditModal';
import { Toast } from '../components/Toast';
import { Button, Card, CardBody, CardHeader, EmptyState, StatTile } from '../components/ui';
import { useStudentGames } from '../lib/games';
import { useLessonsForStudent } from '../lib/lessons';
import { useStudentAttempts, useStudentGameProgress, useStudentProgress } from '../lib/progress';
import { buildShareUrl, useStudent } from '../lib/students';

const ATTEMPTS_PAGE_SIZE = 10;

export function StudentDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ from: '/students/$id' });
  const id = params.id;
  const locale = i18n.resolvedLanguage ?? 'en';

  const detail = useStudent(id);
  const lessons = useLessonsForStudent(id ? { studentId: id, page: 1, limit: 10 } : null);
  const games = useStudentGames(id);
  const progress = useStudentProgress(id);
  const gameProgress = useStudentGameProgress(id);
  const [attemptsPage, setAttemptsPage] = useState(1);
  const attempts = useStudentAttempts(id, attemptsPage, ATTEMPTS_PAGE_SIZE);

  const [toast, setToast] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [previewGameId, setPreviewGameId] = useState<string | null>(null);

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
      <p data-testid="student-detail-loading" className="text-sm text-ink-muted">
        {t('common.loading')}
      </p>
    );
  }

  if (!detail.data) {
    return (
      <div
        data-testid="student-not-found"
        className="rounded-lg border border-line bg-surface p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('students.detail.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('students.detail.notFoundBody')}</p>
        <Link
          to="/students"
          className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
          data-testid="student-back-from-missing"
        >
          {t('nav.students')}
        </Link>
      </div>
    );
  }

  const student = detail.data;
  const totals = progress.data?.totals;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const lastActive = totals?.lastAttemptAt
    ? t('students.detail.lastActive', { date: dateFmt.format(new Date(totals.lastAttemptAt)) })
    : t('students.detail.neverActive');
  const hasActivity = (totals?.totalAttempts ?? 0) > 0;
  const gameItems = games.data?.items ?? [];

  return (
    <section data-testid="student-detail" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: t('nav.students'), to: '/students' },
          { label: <Bidi>{student.name}</Bidi>, current: true },
        ]}
      />

      {/* Header card */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
            {initialsFor(student.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-ink">
              <Bidi>{student.name}</Bidi>
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
              {student.nativeLanguage && (
                <span>{t('students.row.l1', { code: student.nativeLanguage.toUpperCase() })}</span>
              )}
              {student.nativeLanguage && <span aria-hidden>·</span>}
              <span>{lastActive}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Share2 size={14} aria-hidden />}
              onClick={() => void onCopyShare()}
              data-testid="student-copy-share"
            >
              {t('students.actions.invite')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Pencil size={14} aria-hidden />}
              onClick={() => setEditOpen(true)}
              data-testid="student-edit-open"
            >
              {t('students.detail.editButton')}
            </Button>
          </div>
          <code
            dir="ltr"
            data-testid="student-share-url"
            className="w-full overflow-hidden text-ellipsis whitespace-nowrap rounded bg-surface-sunken px-2 py-1 text-xs text-ink-muted"
          >
            {buildShareUrl(student.shareToken)}
          </code>
        </CardBody>
      </Card>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile
          label={t('students.detail.stats.attempts')}
          value={String(totals?.totalAttempts ?? 0)}
          Icon={ClipboardList}
        />
        <StatTile
          label={t('students.detail.stats.accuracy')}
          value={
            totals?.overallAccuracy == null
              ? '—'
              : `${Math.round(totals.overallAccuracy * 100)}%`
          }
          Icon={Target}
        />
        <StatTile
          label={t('students.detail.stats.games')}
          value={String(gameItems.length)}
          Icon={GraduationCap}
        />
      </div>

      {/* Practice games */}
      <Card data-testid="student-games">
        <CardHeader>
          <h2 className="text-lg font-semibold text-ink">{t('students.games.title')}</h2>
        </CardHeader>
        <CardBody>
          {games.isLoading && <p className="text-sm text-ink-muted">{t('common.loading')}</p>}
          {!games.isLoading && gameItems.length === 0 && (
            <EmptyState
              Icon={GraduationCap}
              message={t('students.games.empty')}
              testId="student-games-empty"
            />
          )}
          {gameItems.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gameItems.map((g) => (
                <StudentGameCard
                  key={g.id}
                  game={g}
                  locale={locale}
                  onPreview={() => setPreviewGameId(g.id)}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Lessons */}
      <Card data-testid="student-lessons">
        <CardHeader>
          <h2 className="text-lg font-semibold text-ink">{t('lessons.recent.title')}</h2>
          <Button
            size="sm"
            icon={<Plus size={14} aria-hidden />}
            onClick={() => setAddLessonOpen(true)}
            data-testid="student-add-lesson"
          >
            {t('lessons.manualAdd.button')}
          </Button>
        </CardHeader>
        <CardBody>
          {lessons.isLoading && <p className="text-sm text-ink-muted">{t('common.loading')}</p>}
          {!lessons.isLoading && lessons.data && lessons.data.items.length === 0 && (
            <EmptyState message={t('lessons.recent.empty')} testId="student-lessons-empty" />
          )}
          {lessons.data && lessons.data.items.length > 0 && (
            <ul
              data-testid="student-lessons-list"
              className="divide-y divide-line rounded-md border border-line"
            >
              {lessons.data.items.map((l) => (
                <li
                  key={l.id}
                  data-testid={`student-lesson-row-${l.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {l.title ? (
                        <Bidi>{l.title}</Bidi>
                      ) : (
                        dateFmt.format(new Date(l.occurredAt))
                      )}
                    </p>
                    {l.title && (
                      <p className="text-xs text-ink-muted">
                        {dateFmt.format(new Date(l.occurredAt))}
                      </p>
                    )}
                  </div>
                  <Link
                    to="/lessons/$id"
                    params={{ id: l.id }}
                    className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-surface-sunken"
                    data-testid={`student-lesson-open-${l.id}`}
                  >
                    {t('lessons.recent.open')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Progress — collapses to one friendly empty state until the student plays. */}
      {!hasActivity ? (
        <Card data-testid="student-progress-section">
          <CardBody>
            <EmptyState
              Icon={Target}
              title={t('students.detail.noProgressTitle')}
              message={t('students.detail.noProgressBody')}
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <Card data-testid="student-progress-section">
            <CardHeader>
              <h2 className="text-lg font-semibold text-ink">{t('progress.title')}</h2>
            </CardHeader>
            <CardBody>
              {progress.isLoading ? (
                <p className="text-sm text-ink-muted">{t('common.loading')}</p>
              ) : progress.error ? (
                <p data-testid="student-progress-error" className="text-sm text-rose-700">
                  {t('progress.error')}
                </p>
              ) : progress.data ? (
                <ProgressOverview
                  data={progress.data}
                  rtl={i18n.dir(i18n.resolvedLanguage) === 'rtl'}
                  locale={locale}
                  showGames={false}
                />
              ) : null}
            </CardBody>
          </Card>

          <Card data-testid="student-game-progress-section">
            <CardHeader>
              <h2 className="text-lg font-semibold text-ink">{t('progress.adaptive.title')}</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-ink-subtle">{t('students.detail.adaptiveHint')}</p>
              {gameProgress.isLoading ? (
                <p className="text-sm text-ink-muted">{t('common.loading')}</p>
              ) : gameProgress.error ? (
                <p data-testid="student-game-progress-error" className="text-sm text-rose-700">
                  {t('progress.error')}
                </p>
              ) : gameProgress.data ? (
                <GameProgressPanel data={gameProgress.data} locale={locale} />
              ) : null}
            </CardBody>
          </Card>

          <Card data-testid="student-attempts-section">
            <CardHeader>
              <h2 className="text-lg font-semibold text-ink">{t('progress.attempts.title')}</h2>
            </CardHeader>
            <CardBody>
              {attempts.isLoading ? (
                <p className="text-sm text-ink-muted">{t('common.loading')}</p>
              ) : attempts.error ? (
                <p data-testid="student-attempts-error" className="text-sm text-rose-700">
                  {t('progress.error')}
                </p>
              ) : attempts.data ? (
                <RecentAttemptsList
                  data={attempts.data}
                  locale={locale}
                  page={attemptsPage}
                  onPageChange={setAttemptsPage}
                />
              ) : null}
            </CardBody>
          </Card>
        </>
      )}

      <StudentEditModal
        open={editOpen}
        student={student}
        onClose={() => setEditOpen(false)}
        onToast={setToast}
        onDeleted={() => void navigate({ to: '/students' })}
      />

      <AddLessonModal
        open={addLessonOpen}
        studentId={id}
        onClose={() => setAddLessonOpen(false)}
        onCreated={(lessonId) => void navigate({ to: '/lessons/$id', params: { id: lessonId } })}
      />

      <GamePreviewDialog gameId={previewGameId} onClose={() => setPreviewGameId(null)} />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="student-toast" />}
    </section>
  );
}

interface StudentGameCardProps {
  game: StudentGameSummary;
  locale: string;
  onPreview: () => void;
}

function StudentGameCard({ game, locale, onPreview }: StudentGameCardProps) {
  const { t } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <li
      data-testid={`student-game-${game.id}`}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          <Bidi>{game.title}</Bidi>
        </p>
        <span
          className={[
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
            game.status === 'ASSIGNED'
              ? 'bg-emerald-100 text-emerald-800'
              : game.status === 'FAILED'
                ? 'bg-rose-100 text-rose-800'
                : 'bg-surface-sunken text-ink-muted',
          ].join(' ')}
        >
          {t(`games.status.${game.status}`)}
        </span>
      </div>
      <p className="text-xs text-ink-subtle">
        {game.type === 'FILL_BLANK' ? t('games.typeFillBlank') : t('games.typeTimedQuiz')}
        {game.questionCount > 0 && (
          <> · {t('games.questionCount', { count: game.questionCount })}</>
        )}
      </p>
      <p className="text-xs text-ink-muted">
        {game.lastPlayedAt
          ? t('students.games.lastPlayed', { date: dateFmt.format(new Date(game.lastPlayedAt)) })
          : t('students.games.neverPlayed')}
        {game.accuracy != null && ` · ${t('students.games.accuracy', { pct: Math.round(game.accuracy * 100) })}`}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Link
          to="/lessons/$id"
          params={{ id: game.lessonId }}
          className="inline-flex flex-1 items-center justify-center rounded-md border border-line px-2 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunken"
          data-testid={`student-game-open-${game.id}`}
        >
          {t('students.games.open')}
        </Link>
        {game.questionCount > 0 && (
          <button
            type="button"
            onClick={onPreview}
            className="inline-flex flex-1 items-center justify-center rounded-md bg-brand-50 px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
            data-testid={`student-game-preview-${game.id}`}
          >
            {t('students.games.preview')}
          </button>
        )}
      </div>
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
