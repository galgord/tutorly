/**
 * Pseudo-localization post-processor for i18next.
 *
 * When the active locale is "pseudo", every resolved string is wrapped with
 * `⟦ … ⟧` markers and inflated by ~30% to surface hardcoded strings and
 * catch layout truncation. Interpolation placeholders (`{{name}}`) and
 * leading/trailing whitespace are preserved so layout + DOM structure stays
 * realistic.
 *
 * Implemented as a string transform (not a 4th locale file) so the
 * transform stays accurate as keys evolve — nothing to keep in sync.
 */

const PSEUDO_LOCALE = 'pseudo';

// Splits a string into segments that are either an `{{interpolation}}` token
// (which must NOT be inflated) or plain text (which IS inflated).
const INTERP_RE = /(\{\{[^}]+\}\})/g;

function inflateSegment(segment: string): string {
  if (segment.length === 0) return segment;
  // Repeat every 3rd character's *vowel-ish* glyph to add ~30% length without
  // mangling the original characters (so tests can still substring-match).
  // We append a small run after select positions rather than mutating chars,
  // which keeps interpolation-adjacent whitespace stable.
  const inflateRatio = 0.3;
  const extra = Math.max(1, Math.round(segment.length * inflateRatio));
  return segment + '·'.repeat(extra);
}

/**
 * Transforms a single string. Exposed for unit tests.
 */
export function pseudoize(input: string): string {
  if (typeof input !== 'string') return input;
  // Preserve leading + trailing whitespace exactly (i18next strings sometimes
  // include them for inline composition).
  const match = input.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return `⟦${input}⟧`;
  const [, lead, core, trail] = match;
  if (!core) return input;
  const parts = core.split(INTERP_RE);
  const transformed = parts
    .map((part) => (INTERP_RE.test(part) ? part : inflateSegment(part)))
    .join('');
  // Reset the regex state — split + test share lastIndex on the same instance.
  INTERP_RE.lastIndex = 0;
  return `${lead}⟦${transformed}⟧${trail}`;
}

interface PostProcessorInput {
  name: string;
  type: 'postProcessor';
  process(value: unknown, _key: unknown, _options: unknown, translator: { language?: string }): unknown;
}

export const pseudoPostProcessor: PostProcessorInput = {
  name: 'pseudo',
  type: 'postProcessor',
  process(value, _key, _options, translator) {
    if (translator?.language !== PSEUDO_LOCALE) return value;
    if (typeof value === 'string') return pseudoize(value);
    if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? pseudoize(v) : v));
    return value;
  },
};

export { PSEUDO_LOCALE };
