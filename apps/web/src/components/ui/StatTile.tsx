import type { LucideIcon } from 'lucide-react';

interface StatTileProps {
  label: string;
  value: string;
  Icon?: LucideIcon;
  hint?: string;
  testId?: string;
}

/** Compact metric card — label, big value, optional icon + sub-hint. */
export function StatTile({ label, value, Icon, hint, testId }: StatTileProps) {
  return (
    <div data-testid={testId} className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        {Icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
            <Icon size={16} aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}
