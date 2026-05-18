import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from './quota.service';

/**
 * Live-Postgres tests for the per-tutor cap. The atomic
 * UPDATE ... WHERE monthlyGenerations < cap pattern can't be verified
 * in mocked-prisma unit tests — Postgres is the SQL engine that
 * actually enforces the race-free check.
 *
 * Skips automatically if DATABASE_URL is unreachable.
 */
describe('Quota enforcement (live db)', () => {
  const prisma = new PrismaService();
  let dbReady = false;
  let tutorId = '';

  const config: ConfigService = {
    get: vi.fn((key: string) => {
      if (key === 'GAME_GEN_MONTHLY_CAP') return 5;
      if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 60;
      return undefined;
    }),
    isProd: () => false,
  } as unknown as ConfigService;

  let svc: QuotaService;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    svc = new QuotaService(prisma, config, new AuditService(prisma));
  });

  beforeEach(async () => {
    if (!dbReady) return;
    const t = await prisma.tutor.create({
      data: {
        email: `quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      },
    });
    tutorId = t.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { email: { startsWith: 'quota-' } } });
    await prisma.$disconnect();
  });

  it('5 reservations succeed, 6th refuses', async () => {
    if (!dbReady) return;
    for (let i = 0; i < 5; i++) {
      const r = await svc.reserveGeneration(tutorId);
      expect(r.ok, `attempt ${i + 1}`).toBe(true);
    }
    const over = await svc.reserveGeneration(tutorId);
    expect(over.ok).toBe(false);
    expect(over.used).toBe(5);
    expect(over.cap).toBe(5);
  });

  it('concurrent reservations never exceed cap (atomicity)', async () => {
    if (!dbReady) return;
    // Fire 20 reservations in parallel against a cap of 5. Postgres'
    // updateMany WHERE monthlyGenerations < cap serializes them — only
    // exactly 5 should succeed.
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => svc.reserveGeneration(tutorId)),
    );
    const ok = attempts.filter((r) => r.ok);
    expect(ok.length).toBe(5);
    const after = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyGenerations: true },
    });
    expect(after?.monthlyGenerations).toBe(5);
  });

  it('refund gives a slot back; the next reservation succeeds again', async () => {
    if (!dbReady) return;
    for (let i = 0; i < 5; i++) {
      await svc.reserveGeneration(tutorId);
    }
    expect((await svc.reserveGeneration(tutorId)).ok).toBe(false);
    await svc.refundGeneration(tutorId);
    expect((await svc.reserveGeneration(tutorId)).ok).toBe(true);
  });

  it('refund clamps at 0 (no negative balances)', async () => {
    if (!dbReady) return;
    // Tutor starts at 0; many refunds should be no-ops.
    for (let i = 0; i < 5; i++) {
      await svc.refundGeneration(tutorId);
    }
    const after = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyGenerations: true },
    });
    expect(after?.monthlyGenerations).toBe(0);
  });

  it('resetAll zeros counters across all tutors', async () => {
    if (!dbReady) return;
    await svc.reserveGeneration(tutorId);
    await svc.reserveGeneration(tutorId);
    const before = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyGenerations: true },
    });
    expect(before?.monthlyGenerations).toBe(2);

    const n = await svc.resetAll();
    expect(n).toBeGreaterThanOrEqual(1);

    const after = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyGenerations: true, monthlyGenerationsResetAt: true },
    });
    expect(after?.monthlyGenerations).toBe(0);
    // resetAt was just updated to roughly now.
    const ageMs = Date.now() - (after?.monthlyGenerationsResetAt?.getTime() ?? 0);
    expect(ageMs).toBeLessThan(5_000);
  });

  it('aggregate usage reflects per-tutor sums', async () => {
    if (!dbReady) return;
    await svc.reserveGeneration(tutorId);
    await svc.reserveGeneration(tutorId);
    const agg = await svc.getAggregateUsage();
    expect(agg.totalGenerationsThisMonth).toBeGreaterThanOrEqual(2);
    expect(agg.capGenerations).toBe(5);
  });

  // ---- Phase 5: Whisper minute reserve/refund ---------------------------

  it('whisper: sequential 5x1-minute reserves succeed, 6th refuses (under cap=60 we test a smaller cap)', async () => {
    if (!dbReady) return;
    // Lower the whisper cap by injecting a fresh config + service. The
    // shared `svc` instance has cap=60 which would require too many
    // sequential reserves to be useful.
    const smallCapConfig = {
      get: vi.fn((key: string) => {
        if (key === 'GAME_GEN_MONTHLY_CAP') return 5;
        if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 5;
        return undefined;
      }),
      isProd: () => false,
    } as unknown as ConfigService;
    const small = new QuotaService(prisma, smallCapConfig, new AuditService(prisma));
    for (let i = 0; i < 5; i++) {
      const r = await small.reserveWhisperMinutes(tutorId, 1);
      expect(r.ok, `attempt ${i + 1}`).toBe(true);
    }
    const over = await small.reserveWhisperMinutes(tutorId, 1);
    expect(over.ok).toBe(false);
    expect(over.used).toBe(5);
    expect(over.cap).toBe(5);
  });

  it('whisper: a 3-minute reserve into a 5-cap with 4 used refuses (not partial)', async () => {
    if (!dbReady) return;
    const smallCapConfig = {
      get: vi.fn((key: string) => {
        if (key === 'GAME_GEN_MONTHLY_CAP') return 5;
        if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 5;
        return undefined;
      }),
      isProd: () => false,
    } as unknown as ConfigService;
    const small = new QuotaService(prisma, smallCapConfig, new AuditService(prisma));
    await small.reserveWhisperMinutes(tutorId, 4);
    const over = await small.reserveWhisperMinutes(tutorId, 3); // 4+3=7 > 5
    expect(over.ok).toBe(false);
    const after = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyWhisperMinutes: true },
    });
    expect(after?.monthlyWhisperMinutes).toBe(4); // unchanged
  });

  it('whisper: concurrent reservations never exceed cap (atomicity)', async () => {
    if (!dbReady) return;
    const smallCapConfig = {
      get: vi.fn((key: string) => {
        if (key === 'GAME_GEN_MONTHLY_CAP') return 5;
        if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 5;
        return undefined;
      }),
      isProd: () => false,
    } as unknown as ConfigService;
    const small = new QuotaService(prisma, smallCapConfig, new AuditService(prisma));
    // Fire 20 parallel 1-minute reserves against cap=5; exactly 5 succeed.
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => small.reserveWhisperMinutes(tutorId, 1)),
    );
    const ok = attempts.filter((r) => r.ok);
    expect(ok.length).toBe(5);
    const after = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyWhisperMinutes: true },
    });
    expect(after?.monthlyWhisperMinutes).toBe(5);
  });

  it('whisper: refund gives minutes back; next reserve succeeds again', async () => {
    if (!dbReady) return;
    const smallCapConfig = {
      get: vi.fn((key: string) => {
        if (key === 'GAME_GEN_MONTHLY_CAP') return 5;
        if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 5;
        return undefined;
      }),
      isProd: () => false,
    } as unknown as ConfigService;
    const small = new QuotaService(prisma, smallCapConfig, new AuditService(prisma));
    await small.reserveWhisperMinutes(tutorId, 5);
    expect((await small.reserveWhisperMinutes(tutorId, 1)).ok).toBe(false);
    await small.refundWhisperMinutes(tutorId, 2);
    const ok = await small.reserveWhisperMinutes(tutorId, 2);
    expect(ok.ok).toBe(true);
  });

  it('whisper: refund clamps at 0 (no negative balances)', async () => {
    if (!dbReady) return;
    for (let i = 0; i < 3; i++) {
      await svc.refundWhisperMinutes(tutorId, 1);
    }
    const after = await prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyWhisperMinutes: true },
    });
    expect(after?.monthlyWhisperMinutes).toBe(0);
  });
});
