import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type BreadcrumbCrumb =
  | { label: ReactNode; to: LinkProps['to']; params?: LinkProps['params'] }
  | { label: ReactNode; current: true };

interface BreadcrumbsProps {
  /** Ordered list of crumbs, root first. Last entry should be `{ current: true }`. */
  crumbs: BreadcrumbCrumb[];
}

/**
 * Tiny breadcrumb trail used on detail pages. Renders as a horizontal list
 * with `›` separators that flip in RTL via the existing `.icon-flip` rule.
 * The current page is plain text — non-current entries are router links.
 */
export function Breadcrumbs({ crumbs }: BreadcrumbsProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('breadcrumbs.label')} className="text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-ink-subtle">
                /
              </span>
            )}
            {'current' in c ? (
              <span aria-current="page" className="font-medium text-ink">
                {c.label}
              </span>
            ) : (
              <Link
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                to={c.to as any}
                params={c.params}
                className="hover:text-ink"
              >
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
