import { GameStatus, GameType, LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { ConfigService } from '../config/config.service';
import { FakeLlmClient } from '../integrations/anthropic/llm.fake';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { BankTopupService } from './bank-topup.service';
import { GameGenerationQueue } from './game-generation.queue';

/**
 * Live-Postgres end-to-end for the Phase 12E auto top-up: a below-target
 * ASSIGNED game gets fresh questions APPENDED in the background, the tutor's
 * SEPARATE top-up budget is decremented, the manual generation quota is left
 * untouched, the game status never changes, and the in-flight flag clears.
 *
 * Skips when DATABASE_URL is unreachable so unit-only runs still pass.
 */
function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    GAME_GEN_MONTHLY_CAP: 100,
    GAME_GEN_TOPUP_MONTHLY_CAP: 50,
    WHISPER_MONTHLY_MINUTES_CAP: 60,
    GAME_GEN_MAX_RETRIES: 0,
    GAME_GEN_BREAKER_THRESHOLD: 5,
    GAME_GEN_BREAKER_RESET_MS: 60_000,
    TOPUP_BATCH_SIZE: 4,
    TOPUP_COOLDOWN_MS: 0,
  };
  return { get: vi.fn((k: string) => values[k]), isProd: () => false } as unknown as ConfigService;
}

describe('Bank top-up integration (live db)', () => {
  const prisma = new PrismaService();
  const config = makeConfig();
  const llm = new FakeLlmClient();
  let queue: GameGenerationQueue;
  let svc: BankTopupService;
  let dbReady = false;
  let tutorId = '';
  let gameId = '';

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    const quota = new QuotaService(prisma, config, new AuditService(prisma));
    queue = new GameGenerationQueue(llm, prisma, config, quota);
    svc = new BankTopupService(prisma, quota, queue, config, new AuditService(prisma));
  });

  beforeEach(async () => {
    if (!dbReady) return;
    llm.__reset();
    const t = await prisma.tutor.create({
      data: { email: `topup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    tutorId = t.id;
    const student = await prisma.student.create({
      data: { tutorId: t.id, name: 'S', shareToken: `tu-${Math.random().toString(36).slice(2, 14)}` },
    });
    const lesson = await prisma.lesson.create({
      data: { studentId: student.id, occurredAt: new Date(), source: LessonSource.MANUAL, feedbackText: 'verbs' },
    });
    const game = await prisma.game.create({
      data: {
        lessonId: lesson.id,
        type: GameType.FILL_BLANK,
        title: 'G',
        status: GameStatus.ASSIGNED,
        assignedAt: new Date(),
        questionPool: [
          { id: 'q0', prompt: 'p0 ___', answer: 'a0', distractors: [], acceptAlternates: [], topicTags: [], difficulty: 1 },
          { id: 'q1', prompt: 'p1 ___', answer: 'a1', distractors: [], acceptAlternates: [], topicTags: [], difficulty: 2 },
        ] as unknown as object,
        poolSize: 2,
        poolTargetSize: 6,
        locale: 'en',
      },
    });
    gameId = game.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { email: { startsWith: 'topup-' } } });
    await prisma.$disconnect();
  });

  it('grows the pool, charges the top-up budget, and leaves status + manual quota untouched', async () => {
    if (!dbReady) return;
    await svc.maybeTopUp(gameId);
    await queue.drain();

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    const pool = game!.questionPool as Array<{ id: string }>;
    expect(pool.length).toBeGreaterThan(2); // appended fresh questions
    expect(pool.length).toBeLessThanOrEqual(6); // bounded by poolTargetSize
    expect(game!.status).toBe(GameStatus.ASSIGNED); // never flipped
    expect(game!.topUpInFlight).toBe(false); // flag cleared
    expect(game!.lastTopUpAt).not.toBeNull();
    // The original questions are still present (append, not replace).
    expect(pool.map((q) => q.id)).toEqual(expect.arrayContaining(['q0', 'q1']));

    const tutor = await prisma.tutor.findUnique({ where: { id: tutorId } });
    expect(tutor!.monthlyTopUpGenerations).toBe(1); // top-up budget charged
    expect(tutor!.monthlyGenerations).toBe(0); // manual quota untouched
  });

  it('does not top up a game already at its target size', async () => {
    if (!dbReady) return;
    await prisma.game.update({ where: { id: gameId }, data: { poolTargetSize: 2 } });
    await svc.maybeTopUp(gameId);
    await queue.drain();
    const tutor = await prisma.tutor.findUnique({ where: { id: tutorId } });
    expect(tutor!.monthlyTopUpGenerations).toBe(0); // nothing reserved
  });
});
