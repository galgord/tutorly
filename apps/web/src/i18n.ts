import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LOCALES, type Locale } from '@tutor-app/shared';
import en from './locales/en/common.json';
import pt from './locales/pt/common.json';
import he from './locales/he/common.json';
import { PSEUDO_LOCALE, pseudoPostProcessor } from './i18n/pseudo';

// `pseudo` is a frontend-only locale used to surface hardcoded strings and
// catch layout truncation. The keys live in `en/common.json` — the
// `pseudoPostProcessor` transforms every resolved string at render time.
const SUPPORTED_LNGS = [...SUPPORTED_LOCALES, PSEUDO_LOCALE];

void i18n
  .use(LanguageDetector)
  .use(pseudoPostProcessor)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LNGS,
    // pseudo borrows en's bundle so the keys all resolve before the
    // post-processor wraps them.
    nonExplicitSupportedLngs: false,
    fallbackNS: 'common',
    resources: {
      en: { common: en },
      pt: { common: pt },
      he: { common: he },
      pseudo: { common: en },
    },
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    postProcess: ['pseudo'],
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'locale',
      caches: ['localStorage'],
    },
  });

export function currentLocale(): Locale {
  const lng = i18n.resolvedLanguage ?? 'en';
  return (SUPPORTED_LOCALES as readonly string[]).includes(lng) ? (lng as Locale) : 'en';
}

export default i18n;
