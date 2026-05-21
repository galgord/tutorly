import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-2.5 py-1.5 text-xs',
  md: 'gap-2 px-3.5 py-2 text-sm',
};

/** Shared class string — use for router `<Link>`s that should look like a button. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return [
    'inline-flex items-center justify-center rounded-md font-medium transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANT[variant],
    SIZE[size],
  ].join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button, keeps its width. */
  loading?: boolean;
  /** Optional leading icon (replaced by the spinner while loading). */
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className,
  children,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={[buttonClass(variant, size), className ?? ''].join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
