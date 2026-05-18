module.exports = {
  extends: ['../../.eslintrc.cjs'],
  parserOptions: {
    project: false,
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    es2022: true,
  },
  plugins: ['direction'],
  rules: {
    // Enforce Tailwind logical properties — physical direction utilities break RTL.
    'direction/no-physical-direction-classes': 'error',
  },
  ignorePatterns: ['dist', 'node_modules', '*.config.*', 'tests/**'],
};
