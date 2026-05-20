import { GameStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import type { GameGenerationQueue } from './game-generation.queue';
import { makePrismaMock } from '../test/prisma-mock';
import type { QuotaService } from '../quota/quota.service';
import type { AuditService } from '../audit/audit.service';
import { BankTopupService } from './bank-topup.service';

function gameRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'gm_1',
    status: GameStatus.ASSIGNED,
    questionPool: over.questionPool ?? [{ id: 'q1' }], // length 1
    poolTargetSize: (over.poolTargetSize as number) ?? 5,
    lastTopUpAt: (over.lastTopUpAt as Date | null) ?? null,
    topUpInFlight: (over.topUpInFlight as boolean) ?? false,
    lesson: { student: { tutorId: (over.tutorId as string) ?? 't' } },
    ...over,
  };
}

function setup(opts: {
  game?: unknown;
  claimCount?: number;
  reserveOk?: boolean;
  enqAccepted?: boolean;
} = {}) {
  const prisma = makePrismaMock();
  vi.mocked(prisma.game.findUnique).mockResolvedValue(
    (opts.game === undefined ? gameRow() : opts.game) as never,
  );
  vi.mocked(prisma.game.updateMany).mockResolvedValue({ count: opts.claimCount ?? 1 } as never);
  vi.mocked(prisma.game.update).mockResolvedValue({} as never);
  const config = {
    get: vi.fn((k: string) => (k === 'TOPUP_COOLDOWN_MS' ? 60_000 : undefined)),
    isProd: () => false,
  } as unknown as ConfigService;
  const quota = {
    reserveTopUp: vi.fn(async () => ({ ok: opts.reserveOk ?? true, used: 1, cap: 50, resetsAt: new Date() })),
  } as unknown as QuotaService;
  const queue = {
    enqueueTopUp: vi.fn(() => ({ accepted: opts.enqAccepted ?? true, breakerOpen: !(opts.enqAccepted ?? true) })),
  } as unknown as GameGenerationQueue;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const svc = new BankTopupService(prisma, quota, queue, config, audit);
  return { svc, prisma, quota, queue, audit };
}

describe('BankTopupService.maybeTopUp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('claims, reserves budget, enqueues, and audits when the pool is below target', async () => {
    const { svc, prisma, quota, queue, audit } = setup();
    await svc.maybeTopUp('gm_1');
    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: { id: 'gm_1', topUpInFlight: false },
      data: { topUpInFlight: true },
    });
    expect(quota.reserveTopUp).toHaveBeenCalledWith('t');
    expect(queue.enqueueTopUp).toHaveBeenCalledWith('gm_1', { tutorId: 't' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'game.topup.enqueued' }),
    );
  });

  it('skips a non-ASSIGNED game', async () => {
    const { svc, prisma, queue } = setup({ game: gameRow({ status: GameStatus.DRAFT }) });
    await svc.maybeTopUp('gm_1');
    expect(prisma.game.updateMany).not.toHaveBeenCalled();
    expect(queue.enqueueTopUp).not.toHaveBeenCalled();
  });

  it('skips when the pool is already at target', async () => {
    const { svc, queue } = setup({ game: gameRow({ poolTargetSize: 1 }) }); // pool length 1
    await svc.maybeTopUp('gm_1');
    expect(queue.enqueueTopUp).not.toHaveBeenCalled();
  });

  it('skips when a top-up is already in flight', async () => {
    const { svc, prisma } = setup({ game: gameRow({ topUpInFlight: true }) });
    await svc.maybeTopUp('gm_1');
    expect(prisma.game.updateMany).not.toHaveBeenCalled();
  });

  it('skips within the cooldown window', async () => {
    const { svc, queue } = setup({ game: gameRow({ lastTopUpAt: new Date() }) });
    await svc.maybeTopUp('gm_1');
    expect(queue.enqueueTopUp).not.toHaveBeenCalled();
  });

  it('skips when another trigger already claimed the flag (claim race)', async () => {
    const { svc, quota, queue } = setup({ claimCount: 0 });
    await svc.maybeTopUp('gm_1');
    expect(quota.reserveTopUp).not.toHaveBeenCalled();
    expect(queue.enqueueTopUp).not.toHaveBeenCalled();
  });

  it('releases the claim and does not enqueue when over budget', async () => {
    const { svc, prisma, queue } = setup({ reserveOk: false });
    await svc.maybeTopUp('gm_1');
    // Flag released so a future top-up isn't permanently blocked.
    expect(prisma.game.update).toHaveBeenCalledWith({
      where: { id: 'gm_1' },
      data: { topUpInFlight: false },
    });
    expect(queue.enqueueTopUp).not.toHaveBeenCalled();
  });

  it('never throws into the caller (errors are swallowed)', async () => {
    const { svc, prisma } = setup();
    vi.mocked(prisma.game.findUnique).mockRejectedValue(new Error('db down'));
    await expect(svc.maybeTopUp('gm_1')).resolves.toBeUndefined();
  });
});
