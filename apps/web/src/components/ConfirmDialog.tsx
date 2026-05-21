import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from './ui';

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
 * Chrome (overlay, close button, Escape, focus trap) comes from `Modal`.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!props.open) setTyped('');
  }, [props.open]);

  const typedOk =
    props.expectedConfirmText === undefined || typed === props.expectedConfirmText;

  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      testId={props.testId}
      closeTestId="confirm-close"
      title={
        <span className={props.destructive ? 'text-rose-900' : undefined}>
          {props.title}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={props.onCancel} data-testid="confirm-cancel">
            {props.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={props.destructive ? 'danger' : 'primary'}
            disabled={!typedOk}
            loading={props.busy}
            onClick={props.onConfirm}
            data-testid="confirm-submit"
          >
            {props.busy ? t('common.workingOn') : props.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-muted">{props.body}</div>

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
            className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-sm"
            data-testid="confirm-typed-input"
            autoComplete="off"
            autoFocus
          />
        </>
      )}
    </Modal>
  );
}
