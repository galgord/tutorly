import { z } from 'zod';

/**
 * Convenience for "optional env var" fields. Treats empty string the same
 * as missing — important because some shells (and `pnpm`'s .env loader)
 * inject `VAR=""` globally, which would otherwise trip a `.min(1)` check.
 */
const optionalString = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner.optional());

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
