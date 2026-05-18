import { describe, expect, it } from 'vitest';
import {
  detectScript,
  isFuzzyMatch,
  levenshtein,
  normalizeAnswer,
  scoreAnswer,
} from './answers.js';

describe('detectScript', () => {
  it.each([
    ['cat', 'latin'],
    ['gato', 'latin'],
    ['', 'latin'],
    ['שלום', 'hebrew'],
    ['Hello שלום', 'hebrew'],
    ['مرحبا', 'arabic'],
    ['你好', 'cjk'],
    ['日本語', 'cjk'],
  ])('classifies %p as %p', (input, expected) => {
    expect(detectScript(input)).toBe(expected);
  });
});

describe('normalizeAnswer', () => {
  // -- Latin diacritics
  it.each([
    ['café', 'en', 'cafe'],
    ['CAFÉ', 'en', 'cafe'],
    ['CafÉ', 'pt', 'cafe'],
    ['à la mode', 'en', 'a la mode'],
    ['naïve', 'en', 'naive'],
    ['São Paulo', 'pt', 'sao paulo'],
    ['Ångström', 'en', 'angstrom'],
  ])('strips Latin diacritics for %p (locale=%p) → %p', (raw, locale, expected) => {
    expect(normalizeAnswer(raw, { locale })).toBe(expected);
  });

  it('NFC composes pre-decomposed Latin input', () => {
    // "é" can be NFC ("é") or NFD ("é"). After strip both → "e".
    const nfd = 'café';
    const nfc = 'café';
    expect(normalizeAnswer(nfd, { locale: 'en' })).toBe('cafe');
    expect(normalizeAnswer(nfc, { locale: 'en' })).toBe('cafe');
    expect(normalizeAnswer(nfd, { locale: 'en' })).toBe(normalizeAnswer(nfc, { locale: 'en' }));
  });

  it('collapses unicode whitespace (NBSP, tabs, multiple spaces)', () => {
    expect(normalizeAnswer('  hello   world ', { locale: 'en' })).toBe('hello world');
    // U+00A0 NBSP collapsed to single space.
    expect(normalizeAnswer('hello world', { locale: 'en' })).toBe('hello world');
    expect(normalizeAnswer('hello\tworld', { locale: 'en' })).toBe('hello world');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeAnswer(undefined as unknown as string)).toBe('');
    expect(normalizeAnswer(null as unknown as string)).toBe('');
    expect(normalizeAnswer(42 as unknown as string)).toBe('');
  });

  // -- Hebrew nikud (vowel points + cantillation) U+0591..U+05C7
  it.each([
    // bareshit ← בְּרֵאשִׁית (with nikud) → בראשית (without)
    ['בְּרֵאשִׁית', 'he', 'בראשית'],
    // plain hebrew passes through unchanged.
    ['שלום', 'he', 'שלום'],
    // mixed: english + hebrew with nikud, the nikud is stripped, english
    // is lowercased + diacritic-stripped (because the script of the WHOLE
    // string is hebrew here, latin diacritic stripping is NOT applied).
    ['Hello שָׁלוֹם', 'he', 'hello שלום'],
    // Cantillation marks (U+0591..U+05AF) stripped.
    ['שָׁ֔לוֹם', 'he', 'שלום'],
  ])('strips Hebrew nikud for %p → %p', (raw, locale, expected) => {
    expect(normalizeAnswer(raw, { locale })).toBe(expected);
  });

  it('preserves Hebrew final-form letters (no accidental stripping)', () => {
    // final mem (ם), kaf (ך), nun (ן), pe (ף), tsadi (ץ) — these are
    // base letters, not combining marks. Must survive normalization.
    const finals = 'םךןףץ';
    expect(normalizeAnswer(finals, { locale: 'he' })).toBe(finals);
    expect(normalizeAnswer('שלום', { locale: 'he' })).toBe('שלום');
  });

  it('does NOT diacritic-strip when script is detected as hebrew', () => {
    // If we accidentally ran the Latin pipeline on a Hebrew string,
    // some Hebrew points would be stripped as if they were Latin
    // combining marks. Confirm the alef-bet base letters all survive.
    expect(normalizeAnswer('אבגדהוזחטיכלמנסעפצקרשת', { locale: 'he' })).toBe(
      'אבגדהוזחטיכלמנסעפצקרשת',
    );
  });

  it('Hebrew with explicit script override', () => {
    expect(normalizeAnswer('שָׁלוֹם', { script: 'hebrew' })).toBe('שלום');
  });

  it('respects explicit Latin script override (forces diacritic strip)', () => {
    // Force Latin pipeline on a string the auto-detect would call Latin
    // anyway — same outcome.
    expect(normalizeAnswer('Café', { script: 'latin' })).toBe('cafe');
  });

  it('arabic / cjk pass through (no extra stripping by default)', () => {
    expect(normalizeAnswer('مرحبا', { script: 'arabic' })).toBe('مرحبا');
    expect(normalizeAnswer('你好', { script: 'cjk' })).toBe('你好');
  });

  it('locale-aware lowercase (German ß is left alone in NFC)', () => {
    // German lowercase ß stays as ß; Turkish dotted-I would lower
    // differently with locale='tr' but we don't promise that. The hook
    // exists; we don't have a Turkish test fixture in v1.
    expect(normalizeAnswer('Straße', { locale: 'de' })).toBe('straße');
  });

  it('handles empty string', () => {
    expect(normalizeAnswer('', { locale: 'en' })).toBe('');
    expect(normalizeAnswer('   ', { locale: 'en' })).toBe('');
  });
});

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
    ['gato', 'gato', 0],
    ['gato', 'gatos', 1],
    ['gato', 'pato', 1],
    ['gato', 'gat', 1],
  ])('levenshtein(%p, %p) = %i', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });

  it('is symmetric', () => {
    expect(levenshtein('hello', 'helo')).toBe(levenshtein('helo', 'hello'));
  });
});

describe('isFuzzyMatch', () => {
  it('exact match → true (distance 0)', () => {
    expect(isFuzzyMatch('gato', 'gato')).toBe(true);
  });

  it('distance 1 over a long word with default threshold → true', () => {
    expect(isFuzzyMatch('preterite', 'preteritx')).toBe(true);
  });

  it('distance 2 with explicit threshold 2 → true', () => {
    expect(isFuzzyMatch('kitten', 'sittxn', { maxDistance: 2 })).toBe(true);
  });

  it('distance 3 with threshold 2 → false', () => {
    expect(isFuzzyMatch('kitten', 'sitting', { maxDistance: 2 })).toBe(false);
  });

  it('short answers are exact-only by default (cat ≠ bat)', () => {
    expect(isFuzzyMatch('cat', 'bat')).toBe(false);
  });

  it('zero-distance threshold disables fuzzy entirely', () => {
    expect(isFuzzyMatch('gato', 'gatos', { maxDistance: 0 })).toBe(false);
  });
});

describe('scoreAnswer', () => {
  it('exact answer → correct', () => {
    const r = scoreAnswer({ rawAnswer: 'gato', expected: 'Gato' });
    expect(r.correct).toBe(true);
    expect(r.distance).toBe(0);
  });

  it('blank submission → wrong', () => {
    const r = scoreAnswer({ rawAnswer: '   ', expected: 'gato' });
    expect(r.correct).toBe(false);
    expect(r.normalizedActual).toBe('');
  });

  it('wrong answer → false with distance', () => {
    const r = scoreAnswer({ rawAnswer: 'perro', expected: 'gato' });
    expect(r.correct).toBe(false);
    expect(r.distance).toBeGreaterThan(0);
  });

  it('case + diacritic insensitive', () => {
    const r = scoreAnswer({ rawAnswer: 'CAFÉ', expected: 'cafe', locale: 'en' });
    expect(r.correct).toBe(true);
  });

  it('accepts tutor-curated alternate', () => {
    const r = scoreAnswer({
      rawAnswer: 'kitty',
      expected: 'cat',
      acceptAlternates: ['kitty', 'feline'],
    });
    expect(r.correct).toBe(true);
    expect(r.matchedAlternate).toBe('kitty');
  });

  it('fuzzy match opt-in for typo (allowFuzzy)', () => {
    const r = scoreAnswer({
      rawAnswer: 'preteritx',
      expected: 'preterite',
      allowFuzzy: true,
    });
    expect(r.correct).toBe(true);
  });

  it('fuzzy match opt-in: alternate close-but-not-exact', () => {
    const r = scoreAnswer({
      rawAnswer: 'kittx',
      expected: 'cat',
      acceptAlternates: ['kitty'],
      allowFuzzy: true,
    });
    expect(r.correct).toBe(true);
    expect(r.matchedAlternate).toBe('kitty');
  });

  it('fuzzy off by default — typo is wrong', () => {
    const r = scoreAnswer({
      rawAnswer: 'preteritx',
      expected: 'preterite',
    });
    expect(r.correct).toBe(false);
  });

  it('Hebrew: nikud-aware match (with vs without nikud)', () => {
    const r = scoreAnswer({
      rawAnswer: 'שלום',
      expected: 'שָׁלוֹם',
      locale: 'he',
    });
    expect(r.correct).toBe(true);
  });

  it('Hebrew: alternate match strips nikud both sides', () => {
    const r = scoreAnswer({
      rawAnswer: 'שלום',
      expected: 'hi',
      acceptAlternates: ['שָׁלוֹם'],
      locale: 'he',
    });
    expect(r.correct).toBe(true);
  });

  it('ignores empty alternates safely', () => {
    const r = scoreAnswer({
      rawAnswer: '',
      expected: 'cat',
      acceptAlternates: ['', '  '],
    });
    expect(r.correct).toBe(false);
  });
});
