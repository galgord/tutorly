import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameStatus, GameType, LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { ConfigService } from '../config/config.service';
import { FakeLlmClient } from '../integrations/anthropic/llm.fake';
import { LessonService } from '../lessons/lesson.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { GameGenerationQueue } from './game-generation.queue';
import { GamesService } from './games.service';

/**
 * Stub config so we don't trigger the real env-validation (Google envs
 * etc.) when this spec runs in isolation.
 */
function makeTestConfig(): ConfigService {
  const get = vi.fn((key: string) => {
    if (key === 'GAME_GEN_MAX_RETRIES') return 3;
    if (key === 'GAME_GEN_BREAKER_THRESHOLD') return 5;
    if (key === 'GAME_GEN_BREAKER_RESET_MS') return 60_000;
    if (key === 'GAME_GEN_MONTHLY_CAP') return 1_000; // generous; this spec isn't testing the cap
    if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 60;
    return undefined;
  });
  return { get, isProd: () => false } as unknown as ConfigService;
}

/**
 * Live-Postgres smoke for the games tenant-isolation contract.
 *
 * The relationship walks Game → Lesson → Student → Tutor, so this test
 * matters even more than the in-memory unit tests — any prisma `where`
 * mistake (e.g. forgetting the student relation) only shows up against
 * a real DB.
 *
 * Skips automatically if DATABASE_URL is unreachable so unit-only runs
 * (no docker compose) still pass.
 */
describe('Game tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  const llm = new FakeLlmClient();
  let lessons: LessonService;
  let games: GamesService;
  let queue: GameGenerationQueue;
  let tutorA = '';
  let tutorB = '';
  let studentA = '';
  let studentB = '';
  let lessonA = '';
  let lessonB = '';
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    lessons = new LessonService(prisma);
    const config = makeTestConfig();
    const audit = new AuditService(prisma);
    const quota = new QuotaService(prisma, config, audit);
    queue = new GameGenerationQueue(llm, prisma, config, quota);
    games = new GamesService(prisma, queue, quota);
  });

  beforeEach(async () => {
    if (!dbReady) return;
    llm.__reset();
    const a = await prisma.tutor.create({
      data: { email: `game-iso-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const b = await prisma.tutor.create({
      data: { email: `game-iso-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const sa = await prisma.student.create({
      data: { tutorId: a.id, name: 'Sara-A', shareToken: `t-${Math.random().toString(36).slice(2, 12)}` },
    });
    const sb = await prisma.student.create({
      data: { tutorId: b.id, name: 'Sara-B', shareToken: `t-${Math.random().toString(36).slice(2, 12)}` },
    });
    const la = await lessons.createLesson({
      studentId: sa.id,
      tutorId: a.id,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await lessons.updateFeedback({
      id: la.id,
      tutorId: a.id,
      feedbackText: 'Sara confused ser/estar today.',
    });
    const lb = await lessons.createLesson({
      studentId: sb.id,
      tutorId: b.id,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await lessons.updateFeedback({
      id: lb.id,
      tutorId: b.id,
      feedbackText: 'Different feedback for B.',
    });
    tutorA = a.id;
    tutorB = b.id;
    studentA = sa.id;
    studentB = sb.id;
    lessonA = la.id;
    lessonB = lb.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { id: { in: [tutorA, tutorB] } } });
    await prisma.$disconnect();
  });

  it("tutor B cannot create a game against tutor A's lesson", async () => {
    if (!dbReady) return;
    await expect(
      games.createAndEnqueue({
        lessonId: lessonA,
        tutorId: tutorB,
        type: GameType.FILL_BLANK,
        poolSize: 3,
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("tutor B cannot get tutor A's game by id (404, not 401)", async () => {
    if (!dbReady) return;
    const { game } = await games.createAndEnqueue({
      lessonId: lessonA,
      tutorId: tutorA,
      type: GameType.FILL_BLANK,
      poolSize: 3,
      locale: 'en',
    });
    await queue.drain();
    await expect(
      games.getForTutorOrFail({ id: game.id, tutorId: tutorB }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await games.findForTutor({ id: game.id, tutorId: tutorB })).toBeNull();
    // tutor A still sees their own.
    expect(await games.findForTutor({ id: game.id, tutorId: tutorA })).not.toBeNull();
  });

  it("tutor B cannot edit tutor A's game", async () => {
    if (!dbReady) return;
    const { game } = await games.createAndEnqueue({
      lessonId: lessonA,
      tutorId: tutorA,
      type: GameType.FILL_BLANK,
      poolSize: 3,
      locale: 'en',
    });
    await queue.drain();
    await expect(
      games.editQuestions({ id: game.id, tutorId: tutorB, title: 'pwned' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("tutor B cannot assign tutor A's game", async () => {
    if (!dbReady) return;
    const { game } = await games.createAndEnqueue({
      lessonId: lessonA,
      tutorId: tutorA,
      type: GameType.FILL_BLANK,
      poolSize: 3,
      locale: 'en',
    });
    await queue.drain();
    await expect(
      games.assign({ id: game.id, tutorId: tutorB }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("tutor B cannot delete tutor A's game", async () => {
    if (!dbReady) return;
    const { game } = await games.createAndEnqueue({
      lessonId: lessonA,
      tutorId: tutorA,
      type: GameType.FILL_BLANK,
      poolSize: 3,
      locale: 'en',
    });
    await queue.drain();
    await expect(
      games.softDelete({ id: game.id, tutorId: tutorB }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const after = await prisma.game.findUnique({ where: { id: game.id } });
    expect(after?.deletedAt).toBeNull();
  });

  it("listForLesson refuses cross-tenant lesson", async () => {
    if (!dbReady) return;
    await expect(
      games.listForLesson({ lessonId: lessonA, tutorId: tutorB }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('full happy path: create → generate → assign for tutor A', async () => {
    if (!dbReady) return;
    const { game } = await games.createAndEnqueue({
      lessonId: lessonA,
      tutorId: tutorA,
      type: GameType.FILL_BLANK,
      poolSize: 3,
      locale: 'en',
    });
    await queue.drain();
    const after = await games.getForTutorOrFail({ id: game.id, tutorId: tutorA });
    expect(after.status).toBe(GameStatus.DRAFT);
    expect((after.questionPool as unknown[]).length).toBe(3);

    const assigned = await games.assign({ id: game.id, tutorId: tutorA });
    expect(assigned.status).toBe(GameStatus.ASSIGNED);
    expect(assigned.assignedAt).toBeInstanceOf(Date);
  });

  it('rejects generation when feedback is missing', async () => {
    if (!dbReady) return;
    // Lesson with no feedback yet.
    const blank = await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await expect(
      games.createAndEnqueue({
        lessonId: blank.id,
        tutorId: tutorA,
        type: GameType.FILL_BLANK,
        poolSize: 3,
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Reference studentB so eslint doesn't complain about the unused fixture
    // when this assertion path doesn't touch it.
    expect(studentB).toBeTruthy();
    expect(lessonB).toBeTruthy();
  });
});
