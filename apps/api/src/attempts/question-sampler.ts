/**
 * Server-side question sampler. Each Attempt picks `min(sessionSize,
 * poolSize)` questions from the game's questionPool with NO duplicates.
 * The IDs of the sampled questions are persisted on the attempt so the
 * answer endpoint can re-score from the SAME server-known set (the
 * client never gets to choose what counts).
 *
 * RNG: cryptographically-seeded by default (Node's `crypto.randomBytes`).
 * A deterministic injection point exists for tests so the sampler is
 * unit-testable end-to-end.
 */
import { randomBytes } from 'node:crypto';
import type { GameQuestion } from '@tutor-app/shared';

/**
 * Returns a uniform random integer in [0, max). Default uses crypto;
 * pass a custom `rng` in tests for determinism. Calls `rng()` returning
 * a number in [0, 1).
 */
function defaultRng(): number {
  // 53-bit precision from 7 bytes of crypto entropy. Plenty for shuffle.
  const buf = randomBytes(6);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + buf[i]!;
  return n / 0x1000000000000;
}

export interface SampleOpts {
  pool: readonly GameQuestion[];
  sessionSize: number;
  /** Inject for tests. Defaults to cryptographically-seeded. */
  rng?: () => number;
}

/**
 * Fisher-Yates shuffle on a copy of the pool, then slice the first
 * `min(sessionSize, pool.length)` questions. Guarantees:
 *   - No duplicates within the returned set.
 *   - Each question has equal probability of selection.
 *   - Stable order *within* the returned subset (matches shuffle output)
 *     so the client sees the questions in the order the server chose.
 */
export function sampleQuestions(opts: SampleOpts): GameQuestion[] {
  const pool = opts.pool;
  if (pool.length === 0) return [];
  const want = Math.max(0, Math.min(opts.sessionSize | 0, pool.length));
  if (want === 0) return [];
  const rng = opts.rng ?? defaultRng;
  const copy = pool.slice();
  // Partial Fisher-Yates — we only need the first `want` slots fully
  // shuffled. That's O(want), not O(pool.length).
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    if (j !== i) {
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
    }
  }
  return copy.slice(0, want);
}

/**
 * Deterministic seeded RNG for tests — Mulberry32. Cheap, decent
 * statistical properties for shuffle purposes.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
