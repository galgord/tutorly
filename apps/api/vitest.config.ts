import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: [
        'src/auth/**/*.ts',
        'src/students/**/*.ts',
        'src/integrations/**/*.ts',
        'src/lessons/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.module.ts',
        // Live-db integration specs exercise real Postgres; excluded so unit
        // coverage stays meaningful (they cannot run when Postgres is offline).
        'src/students/tenant-isolation.test.ts',
        'src/lessons/tenant-isolation.test.ts',
        // Real Google SDK adapter — never executed in unit tests (the fake
        // client is injected via GOOGLE_CALENDAR_CLIENT instead).
        'src/integrations/google/google-calendar.real.ts',
        // Test-only seed route — used by the seed harness, not unit-tested.
        'src/integrations/google/test-fake-google.controller.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
});
