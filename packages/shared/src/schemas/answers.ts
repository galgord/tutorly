/**
 * Locale-aware answer normalization + fuzzy match + scoring.
 *
 * Used by both the web client (for instant local feedback) AND the api
 * (the authoritative scorer). Server-side is the source of truth — the
 * client's local result is only ever a UX optimization.
 *
 * Normalization pipeline:
 *   1. NFC (Unicode canonical composition)
 *   2. trim + collapse internal whitespace runs to a single space
 *   3. locale-aware lowercase (`toLocaleLowerCase`)
 *   4. script-aware diacritic / nikud handling:
 *      - Latin scripts: strip combining diacritical marks (U+0300–U+036F,
 *        U+1AB0–U+1AFF, U+1DC0–U+1DFF, U+20D0–U+20FF, U+FE20–U+FE2F)
 *      - Hebrew: strip nikud + cantillation marks (U+0591–U+05C7) but
 *        preserve the base letters. Critical: do NOT diacritic-strip
 *        Hebrew (would mangle final-form letters / yud-bet etc.)
 *
 * Levenshtein-based fuzzy matching is opt-in via `allowFuzzy`. The default
 * for short answers (≤4 chars) is OFF — distance-1 against "cat" matches
 * "bat" which is wrong. The threshold is `min(2, ceil(expected.length/4))`
 * so single-character typos in long answers count, but short answers must
 * be exact.
 */

import { z } from 'zod';

// Combining mark ranges we strip for Latin scripts. The character
// classes are built via String.fromCharCode so the source file holds
// no raw combining marks (which would confuse eslint's
// no-misleading-character-class rule and most code editors). The `u`
// flag makes the ranges code-point-based.
const LATIN_DIACRITIC_RE = new RegExp(
  // U+0300–U+036F (combining diacriticals)
  // U+1AB0–U+1AFF (extended)
  // U+1DC0–U+1DFF (supplement)
  // U+20D0–U+20FF (combining symbols)
  // U+FE20–U+FE2F (combining half marks)
  `[${cp(0x0300)}-${cp(0x036f)}` +
    `${cp(0x1ab0)}-${cp(0x1aff)}` +
    `${cp(0x1dc0)}-${cp(0x1dff)}` +
    `${cp(0x20d0)}-${cp(0x20ff)}` +
    `${cp(0xfe20)}-${cp(0xfe2f)}]`,
  'gu',
);
// Hebrew nikud (vowel points) + cantillation marks — U+0591..U+05C7.
const HEBREW_NIKUD_RE = new RegExp(`[${cp(0x0591)}-${cp(0x05c7)}]`, 'gu');

const HEBREW_BASE_RE = new RegExp(
  `[${cp(0x05d0)}-${cp(0x05ea)}${cp(0x05ef)}-${cp(0x05f2)}]`,
  'u',
);
const ARABIC_BASE_RE = new RegExp(`[${cp(0x0600)}-${cp(0x06ff)}]`, 'u');
const CJK_BASE_RE = new RegExp(
  `[${cp(0x4e00)}-${cp(0x9fff)}${cp(0x3040)}-${cp(0x309f)}${cp(0x30a0)}-${cp(0x30ff)}]`,
  'u',
);

function cp(n: number): string {
  return String.fromCodePoint(n);
}

export type ScriptHint = 'latin' | 'hebrew' | 'arabic' | 'cjk' | 'other';

/** Quick codepoint sniff for the script of an answer. */
export function detectScript(s: string): ScriptHint {
  if (HEBREW_BASE_RE.test(s)) return 'hebrew';
  if (ARABIC_BASE_RE.test(s)) return 'arabic';
  if (CJK_BASE_RE.test(s)) return 'cjk';
  // Default to latin — covers en/pt/es/fr/de/it/etc.
  return 'latin';
}

export interface NormalizeOpts {
  /** UI / answer locale hint (en/pt/he). Used for `toLocaleLowerCase`. */
  locale?: string;
  /** Script override; auto-detected from content if absent. */
  script?: ScriptHint;
}

/**
 * Returns a canonical comparison form for an answer string.
 *
 * Pure function — does not mutate input, safe to call from web + api.
 */
export function normalizeAnswer(raw: string, opts: NormalizeOpts = {}): string {
  if (typeof raw !== 'string') return '';
  // 1. NFC composition.
  let s = raw.normalize('NFC');
  // 2. Trim + collapse whitespace (any Unicode whitespace, including U+00A0).
  s = s.replace(/\s+/gu, ' ').trim();
  // 3. Locale-aware lowercase. Falls back to the platform locale if no hint.
  // For Hebrew/Arabic/CJK this is effectively a no-op (no case in those
  // scripts) but it doesn't hurt.
  const locale = opts.locale ?? undefined;
  s = locale ? s.toLocaleLowerCase(locale) : s.toLowerCase();
  // 4. Script-aware diacritic / nikud handling.
  const script = opts.script ?? detectScript(s);
  if (script === 'hebrew') {
    s = s.replace(HEBREW_NIKUD_RE, '');
  } else if (script === 'latin') {
    // NFD to decompose, then strip the combining marks, then NFC back.
    s = s.normalize('NFD').replace(LATIN_DIACRITIC_RE, '').normalize('NFC');
  }
  // arabic / cjk / other → no extra stripping (no clear "diacritic ≈
  // optional" rule we want to apply by default).
  return s;
}

/**
 * Classic Levenshtein edit distance. Iterative two-row implementation;
 * O(min(a,b)) space. Treats each unicode CODE UNIT — for combining marks
 * + surrogate-pair scripts callers should `normalizeAnswer` first.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Use Array.from for proper code-point iteration on basic emoji/Latin.
  const ca = Array.from(a);
  const cb = Array.from(b);
  const m = ca.length;
  const n = cb.length;
  // Always iterate over the shorter string in the inner loop for space.
  if (m < n) return levenshtein(b, a);
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let curr: number[] = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = ca[i - 1] === cb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

export interface FuzzyOpts {
  /** Max allowed edit distance. Defaults to a length-scaled threshold. */
  maxDistance?: number;
}

/** Returns true when `levenshtein(a, b) <= threshold`. */
export function isFuzzyMatch(a: string, b: string, opts: FuzzyOpts = {}): boolean {
  if (a === b) return true;
  // Default: 1 edit per 4 chars, cap at 2. Single-character answers must be
  // exact (max distance 0).
  const fallback = Math.min(2, Math.floor(Math.max(a.length, b.length) / 4));
  const threshold = opts.maxDistance ?? fallback;
  if (threshold <= 0) return false;
  return levenshtein(a, b) <= threshold;
}

export interface ScoreOpts {
  rawAnswer: string;
  expected: string;
  acceptAlternates?: readonly string[];
  locale?: string;
  /**
   * Opt-in fuzzy matching after exact-match fails. Off by default for
   * server-side strict scoring; the web engine may turn it on for forgiving
   * UX, but the server stays strict.
   */
  allowFuzzy?: boolean;
  /** Same threshold knob as `isFuzzyMatch`. */
  maxDistance?: number;
}

export interface ScoreResult {
  correct: boolean;
  normalizedActual: string;
  normalizedExpected: string;
  /** When the match landed via fuzzy distance, the alt that hit. */
  matchedAlternate?: string;
  distance?: number;
}

/**
 * Score a single submitted answer against expected + accepted alternates.
 * Pure — no IO, no randomness. Symmetric: the api and the web client
 * compute the SAME boolean.
 */
export function scoreAnswer(opts: ScoreOpts): ScoreResult {
  const locale = opts.locale;
  const script = detectScript(`${opts.expected} ${opts.rawAnswer}`);
  const normalizedActual = normalizeAnswer(opts.rawAnswer, { locale, script });
  const normalizedExpected = normalizeAnswer(opts.expected, { locale, script });

  if (normalizedActual.length === 0) {
    return { correct: false, normalizedActual, normalizedExpected };
  }

  if (normalizedActual === normalizedExpected) {
    return { correct: true, normalizedActual, normalizedExpected, distance: 0 };
  }

  // Try each tutor-curated alternate exactly.
  for (const alt of opts.acceptAlternates ?? []) {
    const normAlt = normalizeAnswer(alt, { locale, script });
    if (normAlt.length > 0 && normAlt === normalizedActual) {
      return {
        correct: true,
        normalizedActual,
        normalizedExpected,
        matchedAlternate: alt,
        distance: 0,
      };
    }
  }

  if (opts.allowFuzzy) {
    if (isFuzzyMatch(normalizedActual, normalizedExpected, { maxDistance: opts.maxDistance })) {
      return {
        correct: true,
        normalizedActual,
        normalizedExpected,
        distance: levenshtein(normalizedActual, normalizedExpected),
      };
    }
    for (const alt of opts.acceptAlternates ?? []) {
      const normAlt = normalizeAnswer(alt, { locale, script });
      if (normAlt.length === 0) continue;
      if (isFuzzyMatch(normalizedActual, normAlt, { maxDistance: opts.maxDistance })) {
        return {
          correct: true,
          normalizedActual,
          normalizedExpected,
          matchedAlternate: alt,
          distance: levenshtein(normalizedActual, normAlt),
        };
      }
    }
  }

  return {
    correct: false,
    normalizedActual,
    normalizedExpected,
    distance: levenshtein(normalizedActual, normalizedExpected),
  };
}

// ---- Zod helpers (re-used by attempts schemas) -------------------------

export const RawAnswerSchema = z
  .string()
  .max(500, 'Answer too long.')
  .transform((s) => s.normalize('NFC'));
