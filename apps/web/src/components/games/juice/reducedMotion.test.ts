import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './reducedMotion';

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

describe('prefersReducedMotion', () => {
  it('returns false when matchMedia is unavailable (jsdom / SSR)', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reflects the media query result when available', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
  });
});
