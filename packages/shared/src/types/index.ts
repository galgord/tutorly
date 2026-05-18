export type Locale = 'en' | 'pt' | 'he';

export const SUPPORTED_LOCALES = ['en', 'pt', 'he'] as const;
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['he']);

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}
