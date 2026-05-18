import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BaseProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** Visual emphasis for destructive actions (rose vs slate). */
  destructive?: boolean;
  testId?: string;
}

interface SimpleConfirmProps extends BaseProps {
  /** Requires the user to type the given string to enable the confirm button. */
  expectedConfirmText?: undefined;
  confirmInputLabel?: undefined;
}

interface TypedConfirmProps extends BaseProps {
  expectedConfirmText: string;
  confirmInputLabel: string;
}

type ConfirmDialogProps = SimpleConfirmProps | TypedConfirmProps;

/**
 * Modal confirmation dialog. Two modes:
 *  - Simple: shows confirm/cancel buttons (rotate-token).
 *  - Typed: requires the user to type a specific string (delete student).
 * Close button on the visual start edge per RTL guidelines.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.open) setTyped('');
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  if (!props.open) return null;

  const typedOk =
    props.expectedConfirmText === undefined || typed === props.expectedConfirmText;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        ref={dialogRef}
        data-testid={props.testId}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <h2
            id="confirm-title"
            className={`text-lg font-semibold ${props.destructive ? 'text-rose-900' : 'text-slate-900'}`}
          >
            {props.title}
          </h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={props.onCancel}
            // Visual-end of header (rendered on visual right in LTR, visual left in RTL).
            className="ms-2 text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        </div>
        <div className="mt-3 text-sm text-slate-700">{props.body}</div>

        {props.expectedConfirmText !== undefined && (
          <>
            <label htmlFor="confirm-typed" className="mt-4 block text-sm font-medium">
              {props.confirmInputLabel}
            </label>
            <input
              id="confirm-typed"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              data-testid="confirm-typed-input"
              autoComplete="off"
              autoFocus
            />
          </>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            data-testid="confirm-cancel"
          >
            {props.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!typedOk || props.busy}
            onClick={props.onConfirm}
            data-testid="confirm-submit"
            className={`rounded px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              props.destructive ? 'bg-rose-700 hover:bg-rose-800' : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {props.busy ? t('common.workingOn') : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
