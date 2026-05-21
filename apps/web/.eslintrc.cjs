module.exports = {
  extends: ['../../.eslintrc.cjs', 'plugin:i18next/recommended'],
  parserOptions: {
    project: false,
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    es2022: true,
  },
  plugins: ['direction', 'i18next'],
  rules: {
    // Enforce Tailwind logical properties — physical direction utilities break RTL.
    'direction/no-physical-direction-classes': 'error',
    // No hardcoded JSX strings — every user-visible string MUST flow through
    // i18next so all three locales pick it up. Whitelist below covers
    // intrinsic / non-localizable text (single-character glyphs, brand mark,
    // visual punctuation that doesn't translate).
    'i18next/no-literal-string': [
      'error',
      {
        mode: 'jsx-text-only',
        'jsx-components': {
          // <Bidi> only ever wraps already-localized content or a user-supplied
          // value (student name, question text). Don't flag its literal children.
          exclude: ['Trans', 'Bidi'],
        },
        words: {
          exclude: [
            // Pure punctuation, digits, decorative dots/dashes.
            '[0-9!-/:-@[-`{-~]+',
            // SCREAMING_SNAKE constants (test IDs, status enums).
            '[A-Z_-]+',
            // Visual-only single-glyph affordances (close ×, arrows, bullets).
            // The screen-reader-facing aria-label is translated separately.
            '^[×←→·•—–]$',
            // Brand mark — intentionally not translated.
            '^Tutor App$',
            // Whitespace-only fragments (JSX `{' '}` spacers).
            '^\\s+$',
            // Locale display labels in LocaleSwitcher — each is the language's
            // endonym (English, Português, עברית) and is intentionally rendered
            // verbatim regardless of UI locale.
            '^(English|Português|עברית)$',
          ],
        },
      },
    ],
  },
  overrides: [
    {
      // Unit-test files legitimately use literal strings as fixtures/assertions —
      // they are never user-visible, so the no-literal-string rule doesn't apply.
      files: ['**/*.test.{ts,tsx}'],
      rules: { 'i18next/no-literal-string': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.*', 'tests/**'],
};
