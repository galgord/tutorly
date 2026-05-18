import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isRtlLocale, type Locale } from '@tutor-app/shared';

// Tracks whether Hebrew typography (Heebo + Rubik) has been pulled in for the
// current session. Lazy-imported only when the active locale is `he` so that
// English / Portuguese users never pay for the Hebrew font bytes.
let hebrewFontsRequested = false;

async function loadHebrewFonts(): Promise<void> {
  if (hebrewFontsRequested) return;
  hebrewFontsRequested = true;
  // The two `@fontsource-variable/*` packages auto-register `@font-face`
  // declarations on import. Splitting into separate dynamic imports lets Vite
  // keep them in their own chunk away from the en/pt critical path.
  await Promise.all([
    import('@fontsource-variable/heebo'),
    import('@fontsource-variable/rubik'),
  ]);
}

export function useDirection(): 'ltr' | 'rtl' {
  const { i18n } = useTranslation();
  const rawLocale = i18n.resolvedLanguage ?? 'en';
  // pseudo borrows en's metrics + LTR direction.
  const directionLocale = (rawLocale === 'pseudo' ? 'en' : rawLocale) as Locale;
  const dir = isRtlLocale(directionLocale) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.setAttribute('lang', rawLocale);
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.classList.toggle('pseudo-active', rawLocale === 'pseudo');
    if (rawLocale === 'he') {
      // Fire-and-forget; CSS already falls back to system-ui until the font
      // file resolves, so there's no FOIT to manage.
      void loadHebrewFonts();
    }
  }, [rawLocale, dir]);

  return dir;
}
