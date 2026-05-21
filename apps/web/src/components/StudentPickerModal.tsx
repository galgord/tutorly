import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudentResponse } from '@tutor-app/shared';
import { ApiError, api } from '../lib/api';
import { Bidi } from './Bidi';

interface Props {
  open: boolean;
  /** Free-text hint of what's being attached — shown to anchor the choice. */
  contextLabel?: string | null;
  onClose: () => void;
  onPicked: (studentId: string) => void;
}

/**
 * Picks one of the tutor's students.
 *
 * Used by the Calendar page's "Add feedback" path: the Google event doesn't
 * carry tutor↔student association on its own, so the tutor confirms which
 * student the event belongs to before we create a local Lesson row.
 */
export function StudentPickerModal({ open, contextLabel, onClose, onPicked }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const students = useQuery<{ items: StudentResponse[] }, ApiError>({
    queryKey: ['students-picker', query],
    queryFn: () => api.listStudents({ q: query || undefined, page: 1, limit: 30 }),
    enabled: open,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const items = useMemo(() => students.data?.items ?? [], [students.data]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="student-picker-modal"
        className="w-full max-w-md max-h-[80vh] overflow-auto rounded-lg bg-surface p-6 shadow-xl"
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            // Close sits on the inline-start edge (visual-left in LTR,
            // visual-right in RTL) per Phase 8 RTL convention.
            className="me-1 text-ink-subtle hover:text-ink-muted"
            data-testid="student-picker-close"
          >
            ×
          </button>
          <h2 id="picker-title" className="flex-1 text-lg font-semibold">
            {t('studentPicker.title')}
          </h2>
        </div>

        {contextLabel && (
          <p className="mt-2 text-sm text-ink-muted">
            {t('studentPicker.contextLine')} <Bidi>{contextLabel}</Bidi>
          </p>
        )}

        <label htmlFor="picker-query" className="mt-4 block text-sm font-medium">
          {t('studentPicker.searchLabel')}
        </label>
        <input
          id="picker-query"
          type="search"
          dir="auto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('studentPicker.searchPlaceholder')}
          className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
          data-testid="student-picker-query"
          autoFocus
        />

        <div className="mt-4">
          {students.isLoading && (
            <p className="text-sm text-ink-muted">{t('common.loading')}</p>
          )}
          {students.data && items.length === 0 && (
            <p
              data-testid="student-picker-empty"
              className="rounded border border-dashed border-line bg-surface-muted px-3 py-4 text-center text-sm text-ink-muted"
            >
              {query ? t('studentPicker.emptySearch') : t('studentPicker.emptyAll')}
            </p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-line rounded border border-line">
              {items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onPicked(s.id)}
                    className="block w-full text-start px-3 py-2 text-sm hover:bg-surface-muted"
                    data-testid={`student-picker-row-${s.id}`}
                  >
                    <Bidi>{s.name}</Bidi>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
