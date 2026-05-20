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
        'src/games/**/*.ts',
        'src/quota/**/*.ts',
        'src/voice/**/*.ts',
        'src/attempts/**/*.ts',
        'src/progress/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.module.ts',
        // Live-db integration specs exercise real Postgres; excluded so unit
        // coverage stays meaningful (they cannot run when Postgres is offline).
        'src/students/tenant-isolation.test.ts',
        'src/lessons/tenant-isolation.test.ts',
        'src/games/tenant-isolation.test.ts',
        'src/quota/quota-enforcement.test.ts',
        'src/voice/tenant-isolation.test.ts',
        'src/attempts/tenant-isolation.test.ts',
        'src/attempts/progress-tenant-isolation.test.ts',
        'src/attempts/question-review-tenant-isolation.test.ts',
        'src/progress/tenant-isolation.test.ts',
        // Real provider adapters — never executed in unit tests (the fake
        // clients are injected via DI tokens instead).
        'src/integrations/google/google-calendar.real.ts',
        'src/integrations/anthropic/llm.real.ts',
        'src/integrations/openai/whisper.real.ts',
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
