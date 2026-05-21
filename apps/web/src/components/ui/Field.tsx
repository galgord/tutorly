import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

const CONTROL =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[CONTROL, className ?? ''].join(' ')} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={[CONTROL, className ?? ''].join(' ')} {...rest} />;
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Receives the generated id to wire onto the control. */
  children: (id: string) => ReactNode;
}

/**
 * Label + control + hint/error wrapper. Generates an id and hands it to the
 * control via the render-prop so label association is always correct. `error`
 * takes precedence over `hint`.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs text-rose-700">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
