import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  Icon?: LucideIcon;
  title?: string;
  message: string;
  /** Optional CTA, typically a `<Button>` or button-styled `<Link>`. */
  action?: ReactNode;
  testId?: string;
}

/** Dashed-border placeholder for empty lists/sections — guides, not just "nothing here". */
export function EmptyState({ Icon, title, message, action, testId }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center"
    >
      {Icon && <Icon size={28} aria-hidden className="mx-auto text-ink-subtle" />}
      {title && <p className={['text-sm font-medium text-ink', Icon ? 'mt-3' : ''].join(' ')}>{title}</p>}
      <p
        className={[
          'text-sm text-ink-muted',
          title ? 'mt-1' : Icon ? 'mt-3' : '',
        ].join(' ')}
      >
        {message}
      </p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
