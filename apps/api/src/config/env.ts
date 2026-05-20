import { z } from 'zod';

/**
 * Convenience for "optional env var" fields. Treats empty string the same
 * as missing — important because some shells (and `pnpm`'s .env loader)
 * inject `VAR=""` globally, which would otherwise trip a `.min(1)` check.
 */
const optionalString = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner.optional());

/**
 * Boolean env var with a default. `z.coerce.boolean()` is unusable here —
 * it treats the string "false" as truthy — so parse the common spellings.
 */
const booleanEnv = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }, z.boolean());

/** Comma-separated list of non-negative numbers, e.g. "0,1,3,7,16". */
const numberListEnv = (def: number[]) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return def;
    if (Array.isArray(v)) return v;
    return String(v)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
  }, z.array(z.number().min(0)).min(1));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: optionalString(z.string().url()),
  SESSION_COOKIE_SECRET: z
    .string()
    .min(32, 'SESSION_COOKIE_SECRET must be at least 32 chars (used to sign cookies).'),
  MAILER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: optionalString(z.string()),
  MAIL_FROM: z.string().email().default('noreply@tutor-app.dev'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5174'),
  PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),
  // ---- Phase 3 — Google Calendar integration --------------------------
  // All four are optional in dev so the api still boots without a real
  // Google project. If any one of GOOGLE_CLIENT_ID/SECRET/REDIRECT is set
  // OR NODE_ENV=production with Google envs present, the cross-field
  // refinement below requires the full set + the encryption key.
  GOOGLE_CLIENT_ID: optionalString(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optionalString(z.string().min(1)),
  GOOGLE_OAUTH_REDIRECT_URI: optionalString(z.string().url()),
  /**
   * 32-byte key in hex (64 hex chars) used for chacha20-poly1305 encryption
   * of stored Google refresh tokens. Required if any Google envs set.
   */
  INTEGRATION_TOKEN_ENCRYPTION_KEY: optionalString(
    z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'INTEGRATION_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes).'),
  ),
  // ---- Phase 4 — Anthropic / game generation -----------------------------
  // Optional in dev so the api boots without a real key (the FakeLlmClient
  // is injected). Production smoke (Phase 10) verifies a real key is set.
  ANTHROPIC_API_KEY: optionalString(z.string().min(1)),
  // Game generation worker concurrency. 1 is plenty for v1; bump if pool
  // gen latency becomes a UX issue.
  GAME_GEN_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  // Max retries per generation attempt before giving up (spec calls for 3).
  GAME_GEN_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  // Consecutive failure count that opens the circuit (per process).
  GAME_GEN_BREAKER_THRESHOLD: z.coerce.number().int().min(1).max(50).default(5),
  // How long the breaker stays open after tripping (ms).
  GAME_GEN_BREAKER_RESET_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  // ---- Phase 9 — AI quota + cost ----------------------------------------
  // Per-tutor monthly cap on game generations. Spec default 100; bump per
  // env if a power-user tutor needs more.
  GAME_GEN_MONTHLY_CAP: z.coerce.number().int().min(1).max(10_000).default(100),
  // Per-tutor monthly cap on Whisper transcription minutes. Phase 5 wires
  // the increment; Phase 9 scaffolds the field on Tutor so the schema is
  // stable.
  WHISPER_MONTHLY_MINUTES_CAP: z.coerce.number().int().min(1).max(10_000).default(60),
  // Static admin token gating `/admin/*` routes. Optional in dev; required
  // in production by the cross-field refinement below.
  ADMIN_TOKEN: optionalString(z.string().min(16)),
  // ---- Phase 5 — Whisper voice transcription -------------------------
  // Optional in dev so the api boots without a real key (the
  // FakeTranscriberClient is injected). Production smoke (Phase 10)
  // verifies a real key is set.
  OPENAI_API_KEY: optionalString(z.string().min(1)),
  // Filesystem directory used to store raw audio uploads while the
  // Whisper job is pending. Files are deleted post-transcription per
  // spec. In dev we use a relative path under the api workdir; in prod
  // this points at a Railway Volume mount.
  STORAGE_DIR: z.string().min(1).default('./var/audio'),
  // Max retries per transcription attempt before terminal failure.
  WHISPER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  // Consecutive failure count that opens the Whisper breaker (per process).
  WHISPER_BREAKER_THRESHOLD: z.coerce.number().int().min(1).max(50).default(5),
  // How long the Whisper breaker stays open after tripping (ms).
  WHISPER_BREAKER_RESET_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  // In-flight job concurrency for the Whisper worker.
  WHISPER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  // ---- Phase 6 — Attempts / game-engines ----------------------------
  // Hours of inactivity before the abandoned-attempt cron force-finishes
  // an unfinished attempt. Spec default 24h; tests stub down to seconds.
  ATTEMPT_ABANDON_AFTER_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  // Server-side sampling size per attempt. Spec defaults: 10 fill-blank,
  // 20 timed-quiz. Bump per env if pool sizes grow.
  FILL_BLANK_SESSION_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  TIMED_QUIZ_SESSION_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  // ---- Phase 12 — adaptive game engine (cross-play difficulty) ----------
  // Accuracy (over non-review slots) at/above which the NEXT play steps up.
  LEVEL_ADVANCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  // Accuracy floor for a "competent hold". Below this we never auto-advance
  // (a struggling student is never pushed to a harder level).
  LEVEL_HOLD_FLOOR: z.coerce.number().min(0).max(1).default(0.5),
  // Consecutive competent holds at one level before an anti-stall nudge up.
  LEVEL_NUDGE_EVERY_N: z.coerce.number().int().min(1).max(50).default(3),
  // Minimum answered non-review questions before any level change applies.
  LEVEL_MIN_SAMPLE: z.coerce.number().int().min(1).max(50).default(3),
  // When true, very-low-accuracy plays step the level DOWN. Off by default.
  LEVEL_ALLOW_DOWN: booleanEnv(false),
  // ---- Phase 12C — spaced repetition (Leitner) --------------------------
  // Per-box review intervals in DAYS, index = box-1 (box 1..5). A correct
  // answer promotes a box (longer interval); a wrong answer resets to box 1.
  SR_BOX_INTERVALS_DAYS: numberListEnv([0, 1, 3, 7, 16]),
  // Fraction of a session reserved for due reviews (rest is new content).
  REVIEW_FRACTION: z.coerce.number().min(0).max(1).default(0.3),
  // ---- Phase 12E — automatic background bank top-up ---------------------
  // Per-tutor monthly cap on automatic top-up generations. SEPARATE from
  // GAME_GEN_MONTHLY_CAP so top-ups never eat the tutor's manual quota.
  GAME_GEN_TOPUP_MONTHLY_CAP: z.coerce.number().int().min(0).max(10_000).default(50),
  // Questions requested per top-up batch (capped so a game's pool grows toward
  // its poolTargetSize over several top-ups, not all at once).
  TOPUP_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  // Minimum gap between top-ups for one game (debounce). Default 6h.
  TOPUP_COOLDOWN_MS: z.coerce.number().int().min(0).max(604_800_000).default(21_600_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.MAILER === 'resend' && !parsed.data.RESEND_API_KEY) {
    throw new Error('MAILER=resend requires RESEND_API_KEY to be set.');
  }

  // Google integration env consistency: either none or all-three set. The
  // encryption key is required whenever any Google env is set so we never
  // store a refresh token in plaintext. In production the encryption key is
  // additionally required if NODE_ENV=production AND the Google client id is
  // present (i.e. integration enabled in prod).
  const anyGoogleSet =
    !!parsed.data.GOOGLE_CLIENT_ID ||
    !!parsed.data.GOOGLE_CLIENT_SECRET ||
    !!parsed.data.GOOGLE_OAUTH_REDIRECT_URI;
  if (anyGoogleSet) {
    if (
      !parsed.data.GOOGLE_CLIENT_ID ||
      !parsed.data.GOOGLE_CLIENT_SECRET ||
      !parsed.data.GOOGLE_OAUTH_REDIRECT_URI
    ) {
      throw new Error(
        'Google integration requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI to all be set together.',
      );
    }
    if (!parsed.data.INTEGRATION_TOKEN_ENCRYPTION_KEY) {
      throw new Error(
        'INTEGRATION_TOKEN_ENCRYPTION_KEY is required when Google integration env vars are set (64 hex chars).',
      );
    }
  }
  if (
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.GOOGLE_CLIENT_ID &&
    !parsed.data.INTEGRATION_TOKEN_ENCRYPTION_KEY
  ) {
    throw new Error(
      'INTEGRATION_TOKEN_ENCRYPTION_KEY is required in production when Google integration is enabled.',
    );
  }

  return parsed.data;
}
