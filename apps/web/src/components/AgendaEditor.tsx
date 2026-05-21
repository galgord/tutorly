import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Button, Card, CardBody, Textarea } from './ui';
import { Toast } from './Toast';

interface Props {
  lessonId: string;
  initialAgenda: string;
}

const MAX = 4_000;

/**
 * Free-text lesson plan / agenda editor. Unlike feedback this is editable at
 * any time — before the session as a plan, after as a record of what was
 * covered. An empty value is allowed (it clears the agenda). Uses `dir="auto"`
 * so the textarea direction follows the content independently of the locale.
 */
export function AgendaEditor({ lessonId, initialAgenda }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [value, setValue] = useState(initialAgenda);
  const [toast, setToast] = useState<string | null>(null);

  // Re-sync if the server-state changes underneath us (e.g. another tab).
  useEffect(() => {
    setValue(initialAgenda);
  }, [initialAgenda]);

  const dirty = value !== initialAgenda;

  const mutation = useMutation({
    mutationFn: () => api.setLessonAgenda(lessonId, { agenda: value.trim() }),
    onSuccess: async (updated) => {
      qc.setQueryData(['lesson', lessonId], updated);
      // Keep the schedule / dashboard calendar cache in sync.
      await qc.invalidateQueries({ queryKey: ['calendar'] });
      setToast(t('agenda.toast.saved'));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    mutation.mutate();
  };

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} data-testid="lesson-agenda-editor">
          <header>
            <h2 className="text-lg font-semibold text-ink">{t('agenda.title')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t('agenda.subtitle')}</p>
          </header>

          <label
            htmlFor="lesson-agenda-input"
            className="mt-4 block text-sm font-medium text-ink"
          >
            {t('agenda.label')}
          </label>
          <Textarea
            id="lesson-agenda-input"
            data-testid="lesson-agenda-input"
            dir="auto"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            maxLength={MAX}
            placeholder={t('agenda.placeholder')}
            className="mt-1"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-subtle">
            <span data-testid="lesson-agenda-charcount">
              {t('agenda.charCount', { count: value.length, max: MAX })}
            </span>
            {dirty && (
              <span data-testid="lesson-agenda-dirty" className="text-amber-700">
                {t('agenda.unsaved')}
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center justify-end">
            <Button
              type="submit"
              disabled={!dirty}
              loading={mutation.isPending}
              data-testid="lesson-agenda-save"
            >
              {t('agenda.save')}
            </Button>
          </div>
        </form>

        {toast && (
          <Toast
            message={toast}
            onDismiss={() => setToast(null)}
            testId="lesson-agenda-toast"
          />
        )}
      </CardBody>
    </Card>
  );
}
