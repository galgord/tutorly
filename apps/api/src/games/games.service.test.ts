import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameStatus, GameType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaService } from '../quota/quota.service';
import type { GameGenerationQueue } from './game-generation.queue';
import { GamesService, parsePool, QuotaExceededException } from './games.service';
import { makePrismaMock } from '../test/prisma-mock';

function fakeGame(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: (over.id as string) ?? 'gm_1',
    lessonId: (over.lessonId as string) ?? 'les_1',
    type: (over.type as GameType) ?? GameType.FILL_BLANK,
    title: 'Fill-in-the-blank',
    status: (over.status as GameStatus) ?? GameStatus.DRAFT,
    questionPool: (over.questionPool as unknown) ?? [
      {
        id: 'q_1',
        prompt: 'She ___ to school.',
        answer: 'walks',
        distractors: [],
        acceptAlternates: [],
        topicTags: ['present-tense'],
      },
    ],
    poolSize: 30,
    locale: 'en',
    generationError: null,
    deletedAt: null,
    assignedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    generationPromptHash: null,
    lesson: { id: 'les_1', student: { id: 'stu_1', tutorId: 'tutor_a' } },
  };
}

function makeQueueStub(): GameGenerationQueue {
  return {
    enqueue: vi.fn(() => ({ accepted: true, breakerOpen: false })),
    isBreakerOpen: vi.fn(() => false),
    drain: vi.fn(),
    processGeneration: vi.fn(),
    regenerateSingle: vi.fn(),
    snapshot: vi.fn(() => ({
      inFlight: 0,
      breakerOpen: false,
      consecutiveFailures: 0,
      breakerOpenUntilMs: 0,
    })),
    onModuleInit: vi.fn(),
  } as unknown as GameGenerationQueue;
}

function makeQuotaStub(overrides: Partial<QuotaService> = {}): QuotaService {
  return {
    reserveGeneration: vi.fn(async () => ({
      ok: true,
      used: 1,
      cap: 100,
      resetsAt: new Date('2026-06-01T00:00:00Z'),
    })),
    refundGeneration: vi.fn(async () => undefined),
    getUsage: vi.fn(),
    getAggregateUsage: vi.fn(),
    runMonthlyReset: vi.fn(),
    resetAll: vi.fn(),
    ...overrides,
  } as unknown as QuotaService;
}

function makeService(opts: { quota?: QuotaService } = {}) {
  const prisma = makePrismaMock();
  const queue = makeQueueStub();
  const quota = opts.quota ?? makeQuotaStub();
  const svc = new GamesService(prisma, queue, quota);
  return { svc, prisma, queue, quota };
}

describe('GamesService tenant scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('findForTutor returns null on missing game', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(null as never);
    expect(await svc.findForTutor({ id: 'gm_1', tutorId: 'tutor_a' })).toBeNull();
  });

  it('findForTutor returns null when game belongs to another tutor (cross-tenant)', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue({
      ...fakeGame(),
      lesson: { id: 'les_1', student: { id: 'stu_1', tutorId: 'tutor_b' } },
    } as never);
    expect(await svc.findForTutor({ id: 'gm_1', tutorId: 'tutor_a' })).toBeNull();
  });

  it('getForTutorOrFail throws NotFound (not 401) on cross-tenant', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue({
      ...fakeGame(),
      lesson: { id: 'les_1', student: { id: 'stu_1', tutorId: 'tutor_b' } },
    } as never);
    await expect(
      svc.getForTutorOrFail({ id: 'gm_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GamesService.createAndEnqueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to enqueue when lesson belongs to another tutor', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    await expect(
      svc.createAndEnqueue({
        lessonId: 'les_1',
        tutorId: 'tutor_a',
        type: GameType.FILL_BLANK,
        poolSize: 30,
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to enqueue when lesson has no feedback', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      feedbackText: '',
      occurredAt: new Date(Date.now() - 86_400_000),
    } as never);
    await expect(
      svc.createAndEnqueue({
        lessonId: 'les_1',
        tutorId: 'tutor_a',
        type: GameType.FILL_BLANK,
        poolSize: 30,
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to enqueue when the session is still in the future', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      feedbackText: 'real feedback',
      occurredAt: new Date(Date.now() + 7 * 86_400_000),
    } as never);
    await expect(
      svc.createAndEnqueue({
        lessonId: 'les_1',
        tutorId: 'tutor_a',
        type: GameType.FILL_BLANK,
        poolSize: 30,
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Future-gate fires before any quota reservation or game row.
    expect(prisma.game.create).not.toHaveBeenCalled();
  });

  it('creates a GENERATING game and enqueues a job with the tutor id', async () => {
    const { svc, prisma, queue } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      feedbackText: 'real feedback',
      occurredAt: new Date(Date.now() - 86_400_000),
    } as never);
    vi.mocked(prisma.game.create).mockResolvedValue(
      fakeGame({ status: GameStatus.GENERATING }) as never,
    );
    const { game, breakerOpen } = await svc.createAndEnqueue({
      lessonId: 'les_1',
      tutorId: 'tutor_a',
      type: GameType.FILL_BLANK,
      poolSize: 30,
      locale: 'en',
    });
    expect(game.status).toBe(GameStatus.GENERATING);
    expect(breakerOpen).toBe(false);
    expect(queue.enqueue).toHaveBeenCalledWith(game.id, { tutorId: 'tutor_a' });
  });

  it('returns the FAILED game when breaker is open at enqueue time + refunds the quota slot', async () => {
    const { svc, prisma, queue, quota } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      feedbackText: 'real feedback',
      occurredAt: new Date(Date.now() - 86_400_000),
    } as never);
    vi.mocked(prisma.game.create).mockResolvedValue(
      fakeGame({ status: GameStatus.GENERATING }) as never,
    );
    vi.mocked(queue.enqueue).mockReturnValue({ accepted: false, breakerOpen: true });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.FAILED, generationError: 'AI_UNAVAILABLE_CIRCUIT_OPEN' }) as never,
    );
    const { game, breakerOpen } = await svc.createAndEnqueue({
      lessonId: 'les_1',
      tutorId: 'tutor_a',
      type: GameType.FILL_BLANK,
      poolSize: 30,
      locale: 'en',
    });
    expect(breakerOpen).toBe(true);
    expect(game.status).toBe(GameStatus.FAILED);
    // Outage cost — not the tutor's. Slot refunded.
    expect(quota.refundGeneration).toHaveBeenCalledWith('tutor_a');
  });

  it('throws QuotaExceededException with payload when over cap', async () => {
    const quota = makeQuotaStub({
      reserveGeneration: vi.fn(async () => ({
        ok: false,
        used: 100,
        cap: 100,
        resetsAt: new Date('2026-06-01T00:00:00Z'),
      })),
    } as never);
    const { svc, prisma } = makeService({ quota });
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      feedbackText: 'fb',
      occurredAt: new Date(Date.now() - 86_400_000),
    } as never);
    await expect(
      svc.createAndEnqueue({
        lessonId: 'les_1',
        tutorId: 'tutor_a',
        type: GameType.FILL_BLANK,
        poolSize: 30,
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(QuotaExceededException);
    // No game row created if we refuse.
    expect(prisma.game.create).not.toHaveBeenCalled();
  });
});

describe('GamesService.editQuestions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects while game is GENERATING', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.GENERATING }) as never,
    );
    await expect(
      svc.editQuestions({ id: 'gm_1', tutorId: 'tutor_a', title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects edits to ARCHIVED games', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.ARCHIVED }) as never,
    );
    await expect(
      svc.editQuestions({ id: 'gm_1', tutorId: 'tutor_a', title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forces FILL_BLANK questions to contain ___ even if tutor removed it', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await svc.editQuestions({
      id: 'gm_1',
      tutorId: 'tutor_a',
      questions: [
        {
          id: 'q_1',
          prompt: 'no blank token here',
          answer: 'walks',
          distractors: ['a', 'b'], // FILL_BLANK should ignore these
          acceptAlternates: [],
          topicTags: ['x'],
        },
      ],
    });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    const persisted = data.questionPool as Array<{ prompt: string; distractors: unknown[] }>;
    expect(persisted[0]!.prompt).toContain('___');
    expect(persisted[0]!.distractors).toEqual([]);
  });

  it('TIMED_QUIZ with empty distractors gets synthetic placeholders', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ type: GameType.TIMED_QUIZ }) as never,
    );
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await svc.editQuestions({
      id: 'gm_1',
      tutorId: 'tutor_a',
      questions: [
        {
          id: 'q_1',
          prompt: 'What is 2+2?',
          answer: '4',
          distractors: [],
          acceptAlternates: [],
          topicTags: [],
        },
      ],
    });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    const persisted = data.questionPool as Array<{ distractors: string[] }>;
    expect(persisted[0]!.distractors.length).toBeGreaterThan(0);
  });

  it('rejects when neither title nor questions provided is handled at controller, but service tolerates partial', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await svc.editQuestions({ id: 'gm_1', tutorId: 'tutor_a', title: 'New title' });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.title).toBe('New title');
    expect(data.questionPool).toBeUndefined();
  });
});

describe('GamesService.regenerateAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets status to GENERATING + enqueues (counts against quota)', async () => {
    const { svc, prisma, queue, quota } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue(
      fakeGame({ status: GameStatus.GENERATING }) as never,
    );
    const out = await svc.regenerateAll({ id: 'gm_1', tutorId: 'tutor_a' });
    expect(out.status).toBe(GameStatus.GENERATING);
    expect(quota.reserveGeneration).toHaveBeenCalledWith('tutor_a');
    expect(queue.enqueue).toHaveBeenCalledWith('gm_1', { tutorId: 'tutor_a' });
  });

  it('throws QuotaExceededException when over cap before any update', async () => {
    const quota = makeQuotaStub({
      reserveGeneration: vi.fn(async () => ({
        ok: false,
        used: 100,
        cap: 100,
        resetsAt: new Date('2026-06-01T00:00:00Z'),
      })),
    } as never);
    const { svc, prisma } = makeService({ quota });
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    await expect(
      svc.regenerateAll({ id: 'gm_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(QuotaExceededException);
    expect(prisma.game.update).not.toHaveBeenCalled();
  });

  it('refuses regenerate on ARCHIVED', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.ARCHIVED }) as never,
    );
    await expect(
      svc.regenerateAll({ id: 'gm_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GamesService.regenerateOneQuestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces just the targeted question, preserving id', async () => {
    const { svc, prisma, queue } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    vi.mocked(queue.regenerateSingle).mockResolvedValue({
      id: 'q_new',
      prompt: 'NEW: She ___ home.',
      answer: 'goes',
      distractors: [],
      acceptAlternates: [],
      topicTags: ['present'],
    });

    await svc.regenerateOneQuestion({ id: 'gm_1', tutorId: 'tutor_a', questionId: 'q_1' });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    const pool = data.questionPool as Array<{ id: string; prompt: string }>;
    expect(pool).toHaveLength(1);
    // Original id is preserved so client diffs stay minimal.
    expect(pool[0]!.id).toBe('q_1');
    expect(pool[0]!.prompt).toContain('NEW');
  });

  it('throws NotFound when target questionId isn\'t in the pool', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    await expect(
      svc.regenerateOneQuestion({ id: 'gm_1', tutorId: 'tutor_a', questionId: 'q_missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('surfaces AI unavailable as BadRequest', async () => {
    const { svc, prisma, queue } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(queue.regenerateSingle).mockResolvedValue(null);
    await expect(
      svc.regenerateOneQuestion({ id: 'gm_1', tutorId: 'tutor_a', questionId: 'q_1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GamesService.assign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves DRAFT → ASSIGNED with assignedAt set', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await svc.assign({ id: 'gm_1', tutorId: 'tutor_a' });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.status).toBe(GameStatus.ASSIGNED);
    expect(data.assignedAt).toBeInstanceOf(Date);
  });

  it('refuses to assign while GENERATING', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.GENERATING }) as never,
    );
    await expect(
      svc.assign({ id: 'gm_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to assign FAILED games', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ status: GameStatus.FAILED }) as never,
    );
    await expect(
      svc.assign({ id: 'gm_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to assign with empty pool', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(
      fakeGame({ questionPool: [] }) as never,
    );
    await expect(
      svc.assign({ id: 'gm_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GamesService.softDelete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hard-archives (deletedAt set) when no attempts exist', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.attempt.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await svc.softDelete({ id: 'gm_1', tutorId: 'tutor_a' });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.status).toBe(GameStatus.ARCHIVED);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it('archives without deletedAt when attempts exist (preserve history)', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.game.findUnique).mockResolvedValue(fakeGame() as never);
    vi.mocked(prisma.attempt.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.game.update).mockResolvedValue({} as never);
    await svc.softDelete({ id: 'gm_1', tutorId: 'tutor_a' });
    const data = vi.mocked(prisma.game.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.status).toBe(GameStatus.ARCHIVED);
    expect(data.deletedAt).toBeNull();
  });
});

describe('parsePool', () => {
  it('returns [] for non-array input', () => {
    expect(parsePool(null)).toEqual([]);
    expect(parsePool('string')).toEqual([]);
    expect(parsePool({ not: 'an array' })).toEqual([]);
  });

  it('drops items that fail schema validation but keeps valid ones', () => {
    const pool = parsePool([
      { id: 'q_1', prompt: 'p', answer: 'a', distractors: [], acceptAlternates: [], topicTags: [] },
      { totally: 'broken' },
      { id: 'q_2', prompt: 'p2', answer: 'a2', distractors: [], acceptAlternates: [], topicTags: ['x'] },
    ]);
    expect(pool).toHaveLength(2);
    expect(pool.map((q) => q.id)).toEqual(['q_1', 'q_2']);
  });
});
