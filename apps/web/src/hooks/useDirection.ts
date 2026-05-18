import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isRtlLocale, type Locale } from '@tutor-app/shared';

export function useDirection(): 'ltr' | 'rtl' {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', dir);
  }, [locale, dir]);

  return dir;
}
