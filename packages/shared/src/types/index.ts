export type Locale = 'en' | 'pt' | 'he';

export const SUPPORTED_LOCALES = ['en', 'pt', 'he'] as const;
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['he']);

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

// Phase 11 — `Language` is broader than `Locale`. `Locale` controls UI
// direction and the three translated UIs we ship; `Language` covers what
// a tutor might *teach* and what a student's L1 might be. A Hebrew-speaking
// tutor (locale=he) can teach Portuguese (teachingLanguage=pt) to a
// student whose L1 is English (nativeLanguage=en).
export const SUPPORTED_LANGUAGES = [
  'en',
  'pt',
  'he',
  'es',
  'fr',
  'de',
  'it',
  'ar',
] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isRtlLanguage(language: Language): boolean {
  return language === 'he' || language === 'ar';
}
