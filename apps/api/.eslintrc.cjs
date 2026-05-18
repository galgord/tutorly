module.exports = {
  extends: ['../../.eslintrc.cjs'],
  parserOptions: {
    project: false,
  },
  env: {
    node: true,
  },
  ignorePatterns: ['dist', 'node_modules', 'vitest.config.ts'],
};
