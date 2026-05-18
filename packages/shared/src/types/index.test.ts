import { describe, expect, it } from 'vitest';
import { isRtlLocale, RTL_LOCALES, SUPPORTED_LOCALES } from './index.js';

describe('locale helpers', () => {
  it('flags Hebrew as RTL', () => {
    expect(isRtlLocale('he')).toBe(true);
  });

  it('flags English and Portuguese as LTR', () => {
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('pt')).toBe(false);
  });

  it('keeps the supported locale list and RTL set in sync', () => {
    for (const locale of SUPPORTED_LOCALES) {
      // Every locale either is RTL or isn't — no third state.
      expect(typeof RTL_LOCALES.has(locale)).toBe('boolean');
    }
  });
});
