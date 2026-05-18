import { describe, expect, it } from 'vitest';
import { pseudoize, pseudoPostProcessor } from './pseudo';

describe('pseudo-localization', () => {
  describe('pseudoize()', () => {
    it('wraps short strings with ⟦ … ⟧ markers', () => {
      const out = pseudoize('Hello');
      expect(out.startsWith('⟦')).toBe(true);
      expect(out.endsWith('⟧')).toBe(true);
      expect(out).toContain('Hello');
    });

    it('inflates length by roughly 30%', () => {
      const input = 'A reasonably long english string';
      const out = pseudoize(input);
      const innerLength = out.length - 2; // minus the bracket pair
      expect(innerLength).toBeGreaterThanOrEqual(input.length + Math.round(input.length * 0.25));
      expect(innerLength).toBeLessThan(input.length * 1.5);
    });

    it('leaves interpolation placeholders untouched', () => {
      const out = pseudoize('Hello {{name}}, you have {{count}} new messages');
      // Both placeholders must survive verbatim — interpolation drives i18next
      // and any mangling would surface as a runtime crash.
      expect(out).toContain('{{name}}');
      expect(out).toContain('{{count}}');
      // No inflation marker should have been inserted INSIDE the placeholders.
      expect(out).not.toMatch(/\{\{name·+\}\}/);
      expect(out).not.toMatch(/\{\{count·+\}\}/);
      expect(out).not.toMatch(/\{\{·+name/);
      expect(out).not.toMatch(/\{\{·+count/);
    });

    it('preserves leading and trailing whitespace', () => {
      const out = pseudoize('  hello  ');
      expect(out.startsWith('  ⟦')).toBe(true);
      expect(out.endsWith('⟧  ')).toBe(true);
    });

    it('returns whitespace-only strings unchanged', () => {
      // Whitespace fragments are layout glue; transforming them would push
      // the surrounding markup around.
      expect(pseudoize('   ')).toBe('   ');
    });

    it('passes non-string values through untouched', () => {
      // pseudoize is only ever called with strings (post-processor narrows)
      // but the guard exists so it's safe to call on unknown.
      // @ts-expect-error — exercising the runtime guard.
      expect(pseudoize(42)).toBe(42);
    });
  });

  describe('pseudoPostProcessor', () => {
    it('only transforms when the active language is `pseudo`', () => {
      const en = pseudoPostProcessor.process('Hello', 'k', {}, { language: 'en' });
      const ps = pseudoPostProcessor.process('Hello', 'k', {}, { language: 'pseudo' });
      expect(en).toBe('Hello');
      expect(typeof ps).toBe('string');
      expect(ps as string).toContain('⟦');
      expect(ps as string).toContain('Hello');
    });

    it('declares its name + type so i18next can register it', () => {
      expect(pseudoPostProcessor.name).toBe('pseudo');
      expect(pseudoPostProcessor.type).toBe('postProcessor');
    });
  });
});
