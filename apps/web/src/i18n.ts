import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LOCALES, type Locale } from '@tutor-app/shared';
import en from './locales/en/common.json';
import pt from './locales/pt/common.json';
import he from './locales/he/common.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALES],
    resources: {
      en: { common: en },
      pt: { common: pt },
      he: { common: he },
    },
    defaultNS: 'common',
    interpolation: { escapeValue: false },
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
