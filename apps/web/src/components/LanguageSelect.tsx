import { SUPPORTED_LANGUAGES, type Language } from '@tutor-app/shared';
import { useTranslation } from 'react-i18next';

interface Props {
  id: string;
  value: Language | null;
  /** Label shown for the empty option (e.g. "Not set" or "Same as UI language"). */
  emptyLabel: string;
  onChange: (next: Language | null) => void;
  className?: string;
  testId?: string;
}

/**
 * Tutor-facing dropdown for picking a language. Used in three places:
 *   - profile: tutor's `teachingLanguage`
 *   - student form: student's `nativeLanguage`
 * Always `dir="ltr"` because the language codes (en/pt/he/...) flow LTR
 * even on RTL pages, matching how email + URL inputs are handled.
 */
export function LanguageSelect({ id, value, emptyLabel, onChange, className, testId }: Props) {
  const { t } = useTranslation();
  return (
    <select
      id={id}
      dir="ltr"
      value={value ?? ''}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next === '' ? null : (next as Language));
      }}
      className={
        className ??
        'mt-1 rounded border border-slate-300 px-3 py-2 text-sm'
      }
      data-testid={testId}
    >
      <option value="">{emptyLabel}</option>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {t(`languages.${lang}`)}
        </option>
      ))}
    </select>
  );
}
