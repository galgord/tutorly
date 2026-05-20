import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import { DifficultyBackfillService } from './difficulty-backfill.service';

/** A raw (pre-Phase-12) question with no difficulty key → parses as default. */
function rawQ(over: { id: string; answer: string; prompt?: string }) {
  return {
    id: over.id,
    prompt: over.prompt ?? `${'p'.repeat(over.answer.length)} ___`,
    answer: over.answer,
    distractors: [],
    acceptAlternates: [],
    topicTags: ['t'],
  };
}

/** An unrated pool: ≥5 questions, varying scores, no difficulty key. */
function unratedPool() {
  return Array.from({ length: 6 }, (_, i) => rawQ({ id: `q${i}`, answer: 'a'.repeat(i + 1) }));
}

/** An already-rated pool: difficulties spanning tiers. */
function ratedPool() {
  return [1, 2, 3, 4, 5].map((d, i) => ({ ...rawQ({ id: `r${i}`, answer: 'x' }), difficulty: d }));
}

describe('DifficultyBackfillService.run', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-rates unrated pools, skips rated + empty, returns the re-rated count', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.game.findMany).mockResolvedValueOnce([
      { id: 'g_unrated', questionPool: unratedPool() },
      { id: 'g_rated', questionPool: ratedPool() },
      { id: 'g_empty', questionPool: [] },
    ] as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);

    const svc = new DifficultyBackfillService(prisma);
    const count = await svc.run();

    expect(count).toBe(1);
    expect(prisma.game.update).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.game.update).mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'g_unrated' });
    const written = call.data.questionPool as Array<{ difficulty: number }>;
    const levels = new Set(written.map((q) => q.difficulty));
    // The rewritten pool now spans more than one tier.
    expect(levels.size).toBeGreaterThan(1);
  });

  it('paginates with a cursor when a full batch comes back', async () => {
    const prisma = makePrismaMock();
    const fullBatch = Array.from({ length: 200 }, (_, i) => ({
      id: `g${i}`,
      questionPool: [], // empty → skipped, but still drives pagination
    }));
    vi.mocked(prisma.game.findMany)
      .mockResolvedValueOnce(fullBatch as never)
      .mockResolvedValueOnce([{ id: 'g_last', questionPool: unratedPool() }] as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);

    const svc = new DifficultyBackfillService(prisma);
    const count = await svc.run();

    expect(count).toBe(1);
    expect(prisma.game.findMany).toHaveBeenCalledTimes(2);
    // Second page must be cursor-driven (skip the cursor row).
    const secondCall = vi.mocked(prisma.game.findMany).mock.calls[1]![0];
    expect(secondCall).toMatchObject({ skip: 1, cursor: { id: 'g199' } });
  });
});

describe('DifficultyBackfillService.onModuleInit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the sweep without throwing on success', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.game.findMany).mockResolvedValue([] as never);
    const svc = new DifficultyBackfillService(prisma);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('swallows DB errors during boot (no crash)', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.game.findMany).mockRejectedValue(new Error('db down'));
    const svc = new DifficultyBackfillService(prisma);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });
});
