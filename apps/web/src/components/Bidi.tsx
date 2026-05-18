import type { HTMLAttributes, ReactNode } from 'react';

interface BidiProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** Force a direction. Defaults to "auto" which lets the browser infer from content. */
  dir?: 'auto' | 'ltr' | 'rtl';
}

/**
 * Wraps content whose direction may differ from the surrounding context
 * (e.g. an English name in a Hebrew sentence). Prevents bidi mojibake by
 * isolating the inner content's direction from its parent.
 */
export function Bidi({ children, dir = 'auto', style, ...rest }: BidiProps) {
  return (
    <span dir={dir} style={{ unicodeBidi: 'isolate', ...style }} {...rest}>
      {children}
    </span>
  );
}
