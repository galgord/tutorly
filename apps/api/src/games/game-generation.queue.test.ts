import { GameStatus, GameType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import { FakeLlmClient } from '../integrations/anthropic/llm.fake';
import { makePrismaMock } from '../test/prisma-mock';
import { GameGenerationQueue } from './game-generation.queue';

function fakeGame(over: Partial<Record<string, unknown>> = {}) {
  // We accept explicit null/empty for feedbackText (the "no feedback" path),
  // so distinguish "undefined → use default" from "null/'' → carry through".
  const feedbackProvided = Object.prototype.hasOwnProperty.call(over, 'feedbackText');
  const feedbackText = feedbackProvided
    ? (over.feedbackText as string | null)
    : 'Sara confused ser/estar.';
  return {
    id: (over.id as string) ?? 'gm_1',
    lessonId: 'les_1',
    type: (over.type as GameType) ?? GameType.FILL_BLANK,
    title: 'Fill-in-the-blank',
    status: (over.status as GameStatus) ?? GameStatus.GENERATING,
    questionPool: [],
    poolSize: (over.poolSize as number) ?? 3,
    locale: (over.locale as string) ?? 'en',
    generationError: null,
    deletedAt: null,
    assignedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    generationPromptHash: null,
    lesson: {
      feedbackText,
      student: {
        tutorId: 'tutor_a',
        nativeLanguage: null,
        tutor: { subject: null },
      },
    },
  };
}

function makeConfig(over: Partial<Record<string, unknown>> = {}): ConfigService {
  const get = vi.fn((key: string) => {
    if (key === 'GAME_GEN_MAX_RETRIES') return (over.maxRetries as number) ?? 2;
    if (key === 'GAME_GEN_BREAKER_THRESHOLD') return (over.breakerThreshold as number) ?? 3;
    if (key === 'GAME_GEN_BREAKER_RESET_MS') return (over.breakerResetMs as number) ?? 60_000;
    if (key === 'TOPUP_BATCH_SIZE') return (over.topUpBatchSize as number) ?? 20;
    return undefined;
  });
  return { get, isProd: () => false } as unknown as ConfigService;
}

interface QuotaStub {
  refundTopUp: ReturnType<typeof vi.fn>;
  refundGeneration: ReturnType<typeof vi.fn>;
}

function makeQueue(
  overrides: { llm?: FakeLlmClient; config?: ConfigService; withQuota?: boolean } = {},
) {
  const llm = overrides.llm ?? new FakeLlmClient();
  const prisma = makePrismaMock();
  const config = overrides.config ?? makeConfig();
  // updateMany happens in onModuleInit; default the mock to "no stuck rows"
  // so each test can `await q.onModuleInit()` without surprises.
  vi.mocked(prisma.game.updateMany).mockResolvedValue({ count: 0 } as never);
  const quota: QuotaStub | undefined = overrides.withQuota
    ? { refundTopUp: vi.fn(async () => undefined), refundGeneration: vi.fn(async () => undefined) }
    : undefined;
  const queue = new GameGenerationQueue(llm, prisma, config, quota as never);
  return { queue, prisma, llm, config, quota };
}

describe('GameGenerationQueue.onModuleInit', () => {
  it('resets stuck GENERATING rows to FAILED', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.updateMany).mockResolvedValue({ count: 2 } as never);
    await queue.onModuleInit();
    const call = vi.mocked(prisma.game.updateMany).mock.calls[0]?.[0];
    expect(call?.where?.status).toBe(GameStatus.GENERATING);
    expect(call?.data?.status).toBe(GameStatus.FAILED);
  });

  it('tolerates DB failures during boot (doesn\'t crash)', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.updateMany).mockRejectedValue(new Error('connection refused'));
    await expect(queue.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('GameGenerationQueue.processGeneration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the pool + flips status to DRAFT on success', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processGeneration('gm_1');
    const updateCall = vi.mocked(prisma.game.update).mock.calls.find(
      (c) => (c[0]?.data as Record<string, unknown>)?.status === GameStatus.DRAFT,
    );
    expect(updateCall).toBeTruthy();
    const pool = (updateCall![0]?.data as Record<string, unknown>).questionPool as unknown[];
    expect(pool.length).toBe(3);
  });

  it('persists a pool that spans more than one difficulty tier', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame({ poolSize: 5 }) as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processGeneration('gm_1');
    const updateCall = vi.mocked(prisma.game.update).mock.calls.find(
      (c) => (c[0]?.data as Record<string, unknown>)?.status === GameStatus.DRAFT,
    );
    const pool = (updateCall![0]?.data as Record<string, unknown>).questionPool as Array<{
      difficulty: number;
    }>;
    const tiers = new Set(pool.map((q) => q.difficulty));
    expect(tiers.size).toBeGreaterThan(1);
    for (const q of pool) {
      expect(q.difficulty).toBeGreaterThanOrEqual(1);
      expect(q.difficulty).toBeLessThanOrEqual(5);
    }
  });

  it('refuses to clobber a Game that\'s not in GENERATING (idempotency)', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.DRAFT }) as never,
    );
    await queue.processGeneration('gm_1');
    expect(prisma.game.update).not.toHaveBeenCalled();
  });

  it('marks FAILED when the lesson has no feedback (non-retryable)', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ feedbackText: null }) as never,
    );
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processGeneration('gm_1');
    const last = vi.mocked(prisma.game.update).mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
    expect(last.status).toBe(GameStatus.FAILED);
  });

  it('retries on transient rate-limit and eventually succeeds', async () => {
    const llm = new FakeLlmClient();
    llm.__queueRateLimitFailures(2);
    const { queue, prisma } = makeQueue({ llm, config: makeConfig({ maxRetries: 3 }) });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processGeneration('gm_1');
    expect(llm.__callCount()).toBe(3); // 2 failures + 1 success
    const successCall = vi.mocked(prisma.game.update).mock.calls.find(
      (c) => (c[0]?.data as Record<string, unknown>)?.status === GameStatus.DRAFT,
    );
    expect(successCall).toBeTruthy();
  });

  it('marks FAILED after exhausting retries', async () => {
    const llm = new FakeLlmClient();
    llm.__queueRateLimitFailures(10); // way more than maxRetries
    const { queue, prisma } = makeQueue({ llm, config: makeConfig({ maxRetries: 2 }) });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processGeneration('gm_1');
    const last = vi.mocked(prisma.game.update).mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
    expect(last.status).toBe(GameStatus.FAILED);
    expect(last.generationError).toBe('RATE_LIMITED');
  }, 10_000);

  it('breaker trips after N consecutive failures', async () => {
    const llm = new FakeLlmClient();
    llm.__queueUnavailableFailures(100);
    const { queue, prisma } = makeQueue({
      llm,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 2 }),
    });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);

    expect(queue.isBreakerOpen()).toBe(false);
    await queue.processGeneration('gm_1');
    expect(queue.isBreakerOpen()).toBe(false);
    await queue.processGeneration('gm_2');
    expect(queue.isBreakerOpen()).toBe(true);
  });

  it('successful call resets the consecutive-failure counter', async () => {
    const llm = new FakeLlmClient();
    llm.__queueRateLimitFailures(1);
    const { queue, prisma } = makeQueue({
      llm,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 2 }),
    });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    // First call fails (counter=1), second succeeds (counter→0). Breaker
    // should never trip.
    await queue.processGeneration('gm_1');
    await queue.processGeneration('gm_2');
    expect(queue.isBreakerOpen()).toBe(false);
    expect(queue.snapshot().consecutiveFailures).toBe(0);
  });

  it('classifies invalid JSON output as INVALID_OUTPUT', async () => {
    const llm = new FakeLlmClient();
    // Programmed failure that returns junk JSON repeatedly until retries exhaust.
    const original = llm.generate.bind(llm);
    vi.spyOn(llm, 'generate').mockImplementation(async () => {
      const r = await original({
        prompt: {
          system: '',
          gameTypeBlock: 'exactly 3 questions FILL_BLANK',
          userMessage: '',
          cacheKey: 'k',
        },
      });
      return { ...r, rawJson: 'not even close to json' };
    });
    const { queue, prisma } = makeQueue({ llm, config: makeConfig({ maxRetries: 0 }) });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processGeneration('gm_1');
    const last = vi.mocked(prisma.game.update).mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
    expect(last.status).toBe(GameStatus.FAILED);
    expect(last.generationError).toBe('INVALID_OUTPUT');
  });
});

describe('GameGenerationQueue.enqueue + drain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueue returns immediately and drain awaits completion', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    const result = queue.enqueue('gm_1');
    expect(result.accepted).toBe(true);
    expect(result.breakerOpen).toBe(false);
    await queue.drain();
    expect(prisma.game.update).toHaveBeenCalled();
  });

  it('open breaker → enqueue marks game FAILED and refuses processing', async () => {
    const llm = new FakeLlmClient();
    llm.__queueUnavailableFailures(100);
    const { queue, prisma } = makeQueue({
      llm,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 1, breakerResetMs: 60_000 }),
    });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    // Trip the breaker.
    await queue.processGeneration('gm_warmup');
    expect(queue.isBreakerOpen()).toBe(true);

    vi.mocked(prisma.game.update).mockClear();
    const result = queue.enqueue('gm_new');
    expect(result.accepted).toBe(false);
    expect(result.breakerOpen).toBe(true);
    await queue.drain();
    // We should have written FAILED status for gm_new without ever calling
    // the LLM again.
    const last = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(last.status).toBe(GameStatus.FAILED);
    expect(last.generationError).toBe('AI_UNAVAILABLE_CIRCUIT_OPEN');
  });
});

describe('GameGenerationQueue.regenerateSingle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a normalized question matching the gameType', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    const q = await queue.regenerateSingle({
      gameId: 'gm_1',
      gameType: GameType.FILL_BLANK,
      locale: 'en',
    });
    expect(q).not.toBeNull();
    expect(q!.prompt).toContain('___');
    expect(q!.distractors).toEqual([]);
    expect(q!.id).toMatch(/^q_/);
  });

  it('returns null on LLM failure (no throw, no breaker change)', async () => {
    const llm = new FakeLlmClient();
    llm.__queueRateLimitFailures(1);
    const { queue, prisma } = makeQueue({ llm });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    const before = queue.snapshot().consecutiveFailures;
    const q = await queue.regenerateSingle({
      gameId: 'gm_1',
      gameType: GameType.FILL_BLANK,
      locale: 'en',
    });
    expect(q).toBeNull();
    // regenerateSingle bypasses retry/breaker policy by design.
    expect(queue.snapshot().consecutiveFailures).toBe(before);
  });

  it('returns null when breaker is open', async () => {
    const { queue } = makeQueue();
    // Force the breaker open by writing to the internal field via the public
    // contract. We use processGeneration to trip it organically.
    const llm = new FakeLlmClient();
    llm.__queueUnavailableFailures(100);
    const { queue: openQ, prisma } = makeQueue({
      llm,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 1 }),
    });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await openQ.processGeneration('gm_x');
    expect(openQ.isBreakerOpen()).toBe(true);
    const q = await openQ.regenerateSingle({
      gameId: 'gm_x',
      gameType: GameType.FILL_BLANK,
      locale: 'en',
    });
    expect(q).toBeNull();

    // Reference `queue` so eslint-unused doesn't complain about the outer var.
    expect(queue.isBreakerOpen()).toBe(false);
  });
});

describe('GameGenerationQueue — Phase 12E top-up', () => {
  beforeEach(() => vi.clearAllMocks());

  function topUpGame(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'gm_1',
      lessonId: 'les_1',
      type: GameType.FILL_BLANK,
      title: 'T',
      status: GameStatus.ASSIGNED,
      questionPool: (over.questionPool as unknown) ?? [
        { id: 'q1', prompt: 'p1 ___', answer: 'a1', distractors: [], acceptAlternates: [], topicTags: [], difficulty: 2 },
      ],
      poolSize: 5,
      poolTargetSize: (over.poolTargetSize as number) ?? 5,
      generationPromptHash: null,
      locale: 'en',
      generationError: null,
      deletedAt: null,
      assignedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastTopUpAt: null,
      topUpInFlight: true,
      lesson: {
        feedbackText: 'fb',
        student: { tutorId: 't', nativeLanguage: null, tutor: { subject: null } },
      },
    };
  }

  it('appends new questions, stamps lastTopUpAt + clears the flag, and NEVER flips status', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(topUpGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processTopUp('gm_1');
    const data = vi.mocked(prisma.game.update).mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.status).toBeUndefined(); // never touches status
    expect(data.topUpInFlight).toBe(false);
    expect(data.lastTopUpAt).toBeInstanceOf(Date);
    // 1 existing + 4 new (target 5 - existing 1).
    expect((data.questionPool as unknown[]).length).toBe(5);
  });

  it('drops LLM-returned duplicates before appending', async () => {
    const llm = new FakeLlmClient();
    vi.spyOn(llm, 'generate').mockResolvedValue({
      rawJson: JSON.stringify({
        questions: [
          { prompt: 'p1 ___', answer: 'a1', topicTags: [], difficulty: 2 }, // dup of existing
          { prompt: 'brand new ___', answer: 'zzz', topicTags: [], difficulty: 3 }, // new
        ],
      }),
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 },
      model: 'fake',
    });
    const { queue, prisma } = makeQueue({ llm });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(topUpGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await queue.processTopUp('gm_1');
    const pool = (vi.mocked(prisma.game.update).mock.calls[0]![0].data as Record<string, unknown>)
      .questionPool as Array<{ answer: string }>;
    expect(pool).toHaveLength(2); // 1 existing + 1 new (dup dropped)
    expect(pool.map((q) => q.answer)).toContain('zzz');
  });

  it('skips (refund + clear flag, no LLM call) when the pool is already at target', async () => {
    const llm = new FakeLlmClient();
    const genSpy = vi.spyOn(llm, 'generate');
    const { queue, prisma, quota } = makeQueue({ llm, withQuota: true });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(topUpGame({ poolTargetSize: 1 }) as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    queue.enqueueTopUp('gm_1', { tutorId: 't' });
    await queue.drain();
    expect(genSpy).not.toHaveBeenCalled();
    expect(quota!.refundTopUp).toHaveBeenCalledWith('t');
  });

  it('refunds the budget + clears the flag when generation fails', async () => {
    const llm = new FakeLlmClient();
    llm.__queueRateLimitFailures(1);
    const { queue, prisma, quota } = makeQueue({ llm, withQuota: true });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(topUpGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    queue.enqueueTopUp('gm_1', { tutorId: 't' });
    await queue.drain();
    expect(quota!.refundTopUp).toHaveBeenCalledWith('t');
    const clearCall = vi
      .mocked(prisma.game.update)
      .mock.calls.find((c) => (c[0]!.data as Record<string, unknown>).topUpInFlight === false);
    expect(clearCall).toBeTruthy();
  });

  it('onModuleInit clears stale top-up flags', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.game.updateMany).mockResolvedValue({ count: 0 } as never);
    await queue.onModuleInit();
    const topUpSweep = vi
      .mocked(prisma.game.updateMany)
      .mock.calls.find((c) => (c[0]?.where as Record<string, unknown>)?.topUpInFlight === true);
    expect(topUpSweep).toBeTruthy();
    expect((topUpSweep![0].data as Record<string, unknown>).topUpInFlight).toBe(false);
  });
});
