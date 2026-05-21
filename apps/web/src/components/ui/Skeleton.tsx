interface SkeletonProps {
  /** Tailwind sizing/shape classes, e.g. "h-4 w-32 rounded". */
  className?: string;
}

/** Pulsing placeholder block for loading states. Decorative — `aria-hidden`. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div aria-hidden className={['animate-pulse rounded bg-surface-sunken', className ?? ''].join(' ')} />
  );
}
