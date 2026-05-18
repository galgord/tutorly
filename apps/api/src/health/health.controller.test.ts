import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '@tutor-app/shared';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a schema-valid health payload', () => {
    const controller = new HealthController();
    const result = controller.check();
    expect(() => HealthResponseSchema.parse(result)).not.toThrow();
    expect(result.ok).toBe(true);
    expect(result.service).toBe('api');
  });
});
