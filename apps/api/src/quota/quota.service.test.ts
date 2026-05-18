import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { ConfigService } from '../config/config.service';
import { makePrismaMock } from '../test/prisma-mock';
import { QuotaService, nextResetDate } from './quota.service';

function makeConfig(over: Record<string, unknown> = {}): ConfigService {
  return {
    get: vi.fn((key: string) => {
      if (key === 'GAME_GEN_MONTHLY_CAP') return (over.cap as number) ?? 100;
      if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return (over.whisperCap as number) ?? 60;
      return undefined;
    }),
    isProd: () => false,
  } as unknown as ConfigService;
}

function makeAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makeService(over: { config?: ConfigService; audit?: AuditService } = {}) {
  const prisma = makePrismaMock();
  const config = over.config ?? makeConfig();
  const audit = over.audit ?? makeAudit();
  return { svc: new QuotaService(prisma, config, audit), prisma, config, audit };
}

describe('QuotaService.reserveGeneration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reserves when under cap (1 row updated)', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      monthlyGenerations: 50,
      monthlyGenerationsResetAt: new Date('2026-05-01T00:00:00Z'),
    } as never);
    const r = await svc.reserveGeneration('tutor_a');
    expect(r.ok).toBe(true);
    expect(r.used).toBe(50);
    expect(r.cap).toBe(100);
  });

  it('refuses when over cap (0 rows updated) + audits the rejection', async () => {
    const { svc, prisma, audit } = makeService();
    vi.mocked(prisma.tutor.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      monthlyGenerations: 100,
      monthlyGenerationsResetAt: new Date('2026-05-01T00:00:00Z'),
    } as never);
    const r = await svc.reserveGeneration('tutor_a');
    expect(r.ok).toBe(false);
    expect(r.used).toBe(100);
    expect(r.cap).toBe(100);
    const auditCall = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('quota.generation.exceeded');
  });

  it('issues UPDATE with the lt(cap) predicate (atomic)', async () => {
    const { svc, prisma } = makeService({ config: makeConfig({ cap: 50 }) });
    vi.mocked(prisma.tutor.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      monthlyGenerations: 10,
      monthlyGenerationsResetAt: new Date(),
    } as never);
    await svc.reserveGeneration('tutor_a');
    const call = vi.mocked(prisma.tutor.updateMany).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ id: 'tutor_a', monthlyGenerations: { lt: 50 } });
    expect(call?.data).toEqual({ monthlyGenerations: { increment: 1 } });
  });
});

describe('QuotaService.refundGeneration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decrements + audits when there\'s a slot to give back', async () => {
    const { svc, prisma, audit } = makeService();
    vi.mocked(prisma.tutor.updateMany).mockResolvedValue({ count: 1 } as never);
    await svc.refundGeneration('tutor_a');
    const call = vi.mocked(prisma.tutor.updateMany).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ id: 'tutor_a', monthlyGenerations: { gt: 0 } });
    expect(call?.data).toEqual({ monthlyGenerations: { decrement: 1 } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quota.generation.refunded' }),
    );
  });

  it('no-ops when counter would go negative (no audit, no throw)', async () => {
    const { svc, prisma, audit } = makeService();
    vi.mocked(prisma.tutor.updateMany).mockResolvedValue({ count: 0 } as never);
    await svc.refundGeneration('tutor_a');
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('QuotaService.getUsage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns both counters with caps + computed resetsAt', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      monthlyGenerations: 7,
      monthlyGenerationsResetAt: new Date('2026-05-01T00:00:00Z'),
      monthlyWhisperMinutes: 12,
      monthlyWhisperResetAt: new Date('2026-05-01T00:00:00Z'),
    } as never);
    const out = await svc.getUsage('tutor_a');
    expect(out.generationsUsed).toBe(7);
    expect(out.generationsCap).toBe(100);
    expect(out.whisperMinutesUsed).toBe(12);
    expect(out.whisperMinutesCap).toBe(60);
    expect(out.generationsResetsAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns zero-state for a never-loaded tutor', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue(null as never);
    const out = await svc.getUsage('missing');
    expect(out.generationsUsed).toBe(0);
    expect(out.whisperMinutesUsed).toBe(0);
  });
});

describe('QuotaService.resetAll (monthly cron body)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zeros all counters + audits the system action', async () => {
    const { svc, prisma, audit } = makeService();
    vi.mocked(prisma.tutor.updateMany).mockResolvedValue({ count: 12 } as never);
    const n = await svc.resetAll();
    expect(n).toBe(12);
    const call = vi.mocked(prisma.tutor.updateMany).mock.calls[0]?.[0];
    expect(call?.data).toMatchObject({
      monthlyGenerations: 0,
      monthlyWhisperMinutes: 0,
    });
    expect((call?.data as Record<string, unknown>).monthlyGenerationsResetAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quota.monthly.reset' }),
    );
  });
});

describe('nextResetDate', () => {
  it('returns the first of the next UTC month at 00:00', () => {
    const r = nextResetDate(new Date('2026-05-18T17:00:00Z'));
    expect(r.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rolls over December → next January', () => {
    const r = nextResetDate(new Date('2026-12-15T17:00:00Z'));
    expect(r.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
