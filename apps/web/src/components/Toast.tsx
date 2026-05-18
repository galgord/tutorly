import { useEffect } from 'react';

interface ToastProps {
  message: string;
  /** ms before the toast auto-dismisses. */
  durationMs?: number;
  onDismiss: () => void;
  testId?: string;
}

/**
 * Transient bottom-end-corner toast. Uses CSS logical properties so it sits
 * on the visual right in LTR, visual left in RTL — no flex-reverse hacks.
 */
export function Toast({ message, durationMs = 2500, onDismiss, testId }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      // bottom-end-corner via logical insets; stays visually correct in RTL.
      className="fixed bottom-4 end-4 z-50 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      {message}
    </div>
  );
}
