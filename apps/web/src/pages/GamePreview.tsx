import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { GameQuestion, GameResponse } from '@tutor-app/shared';
import { scoreAnswer } from '@tutor-app/shared';
import { Eye } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { ApiError, api } from '../lib/api';

/**
 * `/games/:id/preview` — tutor plays through their own game *exactly as the
 * student will*, but locally only. We re-use the shared `scoreAnswer` so the
 * correct/incorrect verdict matches what the server returns to students. No
 * Attempt rows are written — switching out of preview leaves no audit trail.
 *
 * For TIMED_QUIZ we display the multi-choice variant (prompt + 4 choices);
 * for FILL_BLANK, the text-input variant.
 */
export function GamePreviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ from: '/games/$id/preview' });

  const game = useQuery<GameResponse | null, ApiError>({
    queryKey: ['game', id],
    queryFn: async () => {
      try {
        return await api.getGame(id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });

  if (game.isLoading) {
    return <p className="text-sm text-ink-muted">{t('common.loading')}</p>;
  }
  if (!game.data) {
    return (
      <div
        data-testid="game-preview-not-found"
        className="rounded-lg border border-line bg-surface p-6 text-center"
      >
        <h1 className="text-xl font-semibold">{t('preview.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('preview.notFoundBody')}</p>
      </div>
    );
  }

  const data = game.data;
  return (
    <section data-testid="game-preview" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: t('nav.students'), to: '/students' },
          { label: t('preview.lessonCrumb'), to: '/lessons/$id', params: { id: data.lessonId } },
          { label: t('preview.title'), current: true },
        ]}
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{data.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('preview.subtitle')}</p>
        </div>
        <span
          data-testid="preview-mode-banner"
          className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900"
        >
          <Eye size={14} aria-hidden /> {t('preview.banner')}
        </span>
      </header>

      <PreviewPlayer
        type={data.type}
        questions={data.questionPool}
        locale={data.locale}
        onBack={() => navigate({ to: '/lessons/$id', params: { id: data.lessonId } })}
      />
    </section>
  );
}

interface PreviewPlayerProps {
  type: GameResponse['type'];
  questions: GameQuestion[];
  locale: string;
  onBack: () => void;
}

function PreviewPlayer({ type, questions, locale, onBack }: PreviewPlayerProps) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [graded, setGraded] = useState<null | { correct: boolean; correctAnswer: string }>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const current = questions[idx];
  const total = questions.length;

  useEffect(() => {
    if (!graded) inputRef.current?.focus();
  }, [idx, graded]);

  // Stable order of choices for TIMED_QUIZ so re-renders don't shuffle.
  const choices = useMemo<string[]>(() => {
    if (!current || type !== 'TIMED_QUIZ') return [];
    return shuffleSeeded([current.answer, ...current.distractors.slice(0, 3)], current.id);
  }, [current, type]);

  if (!current) return null;

  const gradeRaw = (raw: string) => {
    const r = scoreAnswer({
      rawAnswer: raw,
      expected: current.answer,
      acceptAlternates: current.acceptAlternates,
      locale,
    });
    if (r.correct) setScore((s) => s + 1);
    setGraded({ correct: r.correct, correctAnswer: current.answer });
  };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || graded) return;
    gradeRaw(trimmed);
  };

  const onChoiceClick = (choice: string) => {
    if (graded) return;
    gradeRaw(choice);
  };

  const next = () => {
    if (idx + 1 >= total) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setValue('');
    setGraded(null);
  };

  const restart = () => {
    setIdx(0);
    setScore(0);
    setGraded(null);
    setValue('');
    setDone(false);
  };

  if (done) {
    return (
      <section
        data-testid="preview-summary"
        data-score={score}
        data-total={total}
        className="space-y-4 rounded-lg border border-line bg-surface p-6 text-center"
      >
        <h2 className="text-xl font-semibold">{t('preview.summary.title')}</h2>
        <p className="text-3xl font-bold text-ink" data-testid="preview-summary-score">
          {t('preview.summary.score', { score, total })}
        </p>
        <p className="text-sm text-ink-muted">{t('preview.summary.body')}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={restart}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            data-testid="preview-restart"
          >
            {t('preview.summary.again')}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
            data-testid="preview-back"
          >
            {t('preview.summary.back')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-6" data-testid="preview-player">
      <header className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-ink-muted">
          {t('preview.progress', { idx: idx + 1, total })}
        </span>
        <span
          aria-live="polite"
          className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold text-ink"
        >
          {t('preview.score', { score })}
        </span>
      </header>

      <p data-testid="preview-prompt" dir="auto" className="text-lg leading-relaxed">
        {current.prompt}
      </p>

      {type === 'FILL_BLANK' ? (
        <form onSubmit={submitText} className="space-y-3">
          <label htmlFor="preview-input" className="sr-only">
            {t('play.fillBlankInputLabel')}
          </label>
          <input
            ref={inputRef}
            id="preview-input"
            dir="auto"
            value={value}
            disabled={!!graded}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            data-testid="preview-input"
          />
          {!graded && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!value.trim()}
                className="rounded-md bg-brand-500 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
                data-testid="preview-submit"
              >
                {t('play.submit')}
              </button>
            </div>
          )}
        </form>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {choices.map((c, i) => (
            <li key={`${current.id}-${i}`}>
              <button
                type="button"
                dir="auto"
                onClick={() => onChoiceClick(c)}
                disabled={!!graded}
                data-testid={`preview-choice-${i}`}
                className={[
                  'w-full rounded-md border px-3 py-2 text-start text-sm transition',
                  graded
                    ? c === current.answer
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-line text-ink-muted opacity-60'
                    : 'border-line bg-surface text-ink hover:border-brand-300 hover:bg-brand-50',
                ].join(' ')}
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}

      {graded && (
        <div
          data-testid="preview-feedback"
          data-correct={graded.correct ? 'true' : 'false'}
          className={[
            'rounded-md p-4 text-sm',
            graded.correct ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900',
          ].join(' ')}
        >
          <p className="font-semibold">
            {graded.correct ? t('play.feedbackCorrect') : t('play.feedbackWrong')}
          </p>
          {!graded.correct && (
            <p className="mt-1" dir="auto">
              {t('play.feedbackCorrectAnswer')}: <strong>{graded.correctAnswer}</strong>
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={next}
              data-testid="preview-next"
              className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600"
              autoFocus
            >
              {idx + 1 >= total ? t('play.finish') : t('play.next')}
              {idx + 1 < total && (
                <span aria-hidden="true" className="icon-flip">
                  →
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// --- Helpers ---------------------------------------------------------------

/** Stable per-question pseudo-shuffle so re-renders don't reorder choices. */
function shuffleSeeded<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 9301 + 49297) % 233280;
    const r = h / 233280;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
