const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RuleTester } = require('eslint');
const plugin = require('../index.cjs');

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

test('no-physical-direction-classes', () => {
  ruleTester.run('no-physical-direction-classes', plugin.rules['no-physical-direction-classes'], {
    valid: [
      '<div className="ms-2 me-4 ps-1 pe-1 text-start text-end" />',
      '<div className="border-s border-e-2 rounded-s rounded-e-md" />',
      '<div className="start-0 end-0" />',
      '<div className="px-4 py-2" />',
      'cn("ms-2", "px-4")',
    ],
    invalid: [
      {
        code: '<div className="ml-2" />',
        errors: [{ messageId: 'banned', data: { cls: 'ml-2', replacement: 'ms-2' } }],
      },
      {
        code: '<div className="text-right text-sm" />',
        errors: [{ messageId: 'banned' }],
      },
      {
        code: '<div className="border-l-2" />',
        errors: [{ messageId: 'banned' }],
      },
      {
        code: 'cn("pl-4 ms-2")',
        errors: [{ messageId: 'banned' }],
      },
    ],
  });

  assert.ok(true);
});
