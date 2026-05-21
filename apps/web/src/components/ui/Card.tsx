import type { HTMLAttributes } from 'react';

/** Surface container — `rounded-lg border border-line bg-surface`. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['rounded-lg border border-line bg-surface', className ?? ''].join(' ')} {...rest}>
      {children}
    </div>
  );
}

/** Card header row — title on the inline-start, actions on the inline-end. */
export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['p-4', className ?? ''].join(' ')} {...rest}>
      {children}
    </div>
  );
}
