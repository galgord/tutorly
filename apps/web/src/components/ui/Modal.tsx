import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const SIZE = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-3xl' } as const;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Footer actions, typically `<Button>`s. */
  footer?: ReactNode;
  size?: keyof typeof SIZE;
  /** data-testid for the panel. */
  testId?: string;
  /** data-testid for the close button. Defaults to `${testId}-close`. */
  closeTestId?: string;
  /** Focus this element on open instead of letting child autoFocus / panel win. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** When false, Escape + backdrop click do not close (e.g. during a mutation). */
  dismissable?: boolean;
}

/**
 * Modal chrome primitive: overlay, Escape-to-close, focus trap, focus restore,
 * inline-start close button. Owns ONLY the shell — callers keep their own
 * state, forms, and footer buttons. Honors a child `autoFocus` (React focuses
 * it on mount; the primitive won't steal focus if something inside already
 * has it).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  testId,
  closeTestId,
  initialFocusRef,
  dismissable = true,
}: ModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Restore focus to whatever was focused before the modal opened.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, [open]);

  // Initial focus — explicit ref wins; otherwise respect a child autoFocus;
  // otherwise focus the panel itself.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      if (panel.contains(document.activeElement)) return; // child autoFocus already won
      panel.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, initialFocusRef]);

  // Escape to close + Tab focus trap.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        tabIndex={-1}
        className={['flex max-h-[85vh] w-full flex-col rounded-lg bg-surface shadow-xl focus:outline-none', SIZE[size]].join(' ')}
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            data-testid={closeTestId ?? (testId ? `${testId}-close` : undefined)}
            className="me-1 rounded p-0.5 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
          <h2 id={titleId} className="flex-1 text-base font-semibold text-ink">
            {title}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
