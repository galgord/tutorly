import { MoreVertical, RefreshCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface StudentRowMenuProps {
  studentId: string;
  /** When true, the destructive actions render as kebab items. */
  onDelete: () => void;
  /** Optional — pages that don't expose rotate-token can omit this. */
  onRotateToken?: () => void;
}

/**
 * Three-dot menu for per-student destructive/rare actions. Keeps the primary
 * row click going to the student detail page — destructive actions never
 * surface as primary buttons on the row.
 *
 * `e.stopPropagation()` on the trigger prevents the wrapping row-link from
 * navigating when the menu is opened.
 */
export function StudentRowMenu({ studentId, onDelete, onRotateToken }: StudentRowMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('students.row.menuLabel')}
        data-testid={`student-menu-${studentId}`}
        className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <MoreVertical size={18} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-20 mt-1 inset-inline-end-0 w-48 rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          {onRotateToken && (
            <MenuItem
              icon={<RefreshCcw size={14} aria-hidden />}
              label={t('students.actions.rotateToken')}
              onClick={() => {
                setOpen(false);
                onRotateToken();
              }}
              testId={`student-menu-rotate-${studentId}`}
            />
          )}
          <MenuItem
            icon={<Trash2 size={14} aria-hidden />}
            label={t('students.actions.delete')}
            destructive
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            testId={`student-menu-delete-${studentId}`}
          />
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
  testId?: string;
}

function MenuItem({ icon, label, destructive, onClick, testId }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      data-testid={testId}
      className={[
        'flex w-full items-center gap-2 px-3 py-2 text-start text-sm',
        destructive ? 'text-rose-700 hover:bg-rose-50' : 'text-ink hover:bg-surface-sunken',
      ].join(' ')}
    >
      <span className={destructive ? 'text-rose-500' : 'text-ink-muted'}>{icon}</span>
      {label}
    </button>
  );
}
