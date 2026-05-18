import { ConfigService } from '../config/config.service';

/** Returns a ConfigService stub seeded with sensible defaults for tests. */
export function makeConfigStub(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://x:y@localhost:5433/tutor_app',
    SESSION_COOKIE_SECRET: 'unit-test-secret-32-chars-minimum-xxxxx',
    MAILER: 'console',
    MAIL_FROM: 'noreply@tutor-app.dev',
    WEB_ORIGIN: 'http://localhost:5174',
    PUBLIC_API_BASE_URL: 'http://localhost:3000',
    // Deterministic key for tests (32 zero bytes → 64 hex chars). Real
    // installations generate a random key via `generateEncryptionKey`.
    INTEGRATION_TOKEN_ENCRYPTION_KEY:
      '0000000000000000000000000000000000000000000000000000000000000000',
    ...overrides,
  };
  return {
    get: (key: string) => defaults[key],
    isProd: () => defaults.NODE_ENV === 'production',
  } as unknown as ConfigService;
}
