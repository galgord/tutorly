import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import type { GameGenerationQueue } from '../games/game-generation.queue';
import { AdminController } from './admin.controller';
import type { QuotaService } from './quota.service';

function makeController(over: { adminToken?: string | undefined } = {}) {
  const config = {
    get: vi.fn((key: string) => (key === 'ADMIN_TOKEN' ? over.adminToken : undefined)),
    isProd: () => false,
  } as unknown as ConfigService;

  const quota = {
    getAggregateUsage: vi.fn().mockResolvedValue({
      tutorCount: 5,
      activeTutorCount: 4,
      totalGenerationsThisMonth: 17,
      totalWhisperMinutesThisMonth: 6,
      capGenerations: 100,
      capWhisperMinutes: 60,
    }),
  } as unknown as QuotaService;

  const queue = {
    snapshot: vi.fn(() => ({
      inFlight: 1,
      breakerOpen: false,
      consecutiveFailures: 0,
      breakerOpenUntilMs: 0,
    })),
  } as unknown as GameGenerationQueue;

  return { ctrl: new AdminController(quota, config, queue), quota, queue, config };
}

describe('AdminController.usage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('403s when ADMIN_TOKEN is not configured (even with a token in header)', async () => {
    const { ctrl } = makeController({ adminToken: undefined });
    await expect(ctrl.usage('anything')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s on wrong token', async () => {
    const { ctrl } = makeController({ adminToken: 'expected-admin-token-12345678' });
    await expect(ctrl.usage('wrong-token-12345678901234567')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403s when no header sent', async () => {
    const { ctrl } = makeController({ adminToken: 'expected-admin-token-12345678' });
    await expect(ctrl.usage(undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s on length-mismatch tokens (constant-time check refuses)', async () => {
    const { ctrl } = makeController({ adminToken: 'expected-admin-token-12345678' });
    await expect(ctrl.usage('short')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns aggregate payload on valid token', async () => {
    const { ctrl } = makeController({ adminToken: 'expected-admin-token-12345678' });
    const out = await ctrl.usage('expected-admin-token-12345678');
    expect(out).toEqual({
      tutors: { total: 5, active: 4 },
      generations: { totalThisMonth: 17, cap: 100 },
      whisper: { totalMinutesThisMonth: 6, capMinutesPerTutor: 60 },
      queue: { inFlight: 1, breakerOpen: false, consecutiveFailures: 0 },
    });
  });
});
