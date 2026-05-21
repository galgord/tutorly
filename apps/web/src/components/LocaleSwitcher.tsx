import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, type Locale } from '@tutor-app/shared';

const LABELS: Record<Locale, string> = {
  en: 'English',
  pt: 'Português',
  he: 'עברית',
};

export function LocaleSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'en') as Locale;

  return (
    <select
      aria-label="Language"
      value={current}
      onChange={(e) => void i18n.changeLanguage(e.target.value)}
      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm"
      dir="ltr"
    >
      {SUPPORTED_LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
