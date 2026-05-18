import { NotFoundException } from '@nestjs/common';
import { GameStatus, GameType, LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptService } from './attempt.service';
import { sampleQuestions } from './question-sampler';

function makeTestConfig(): ConfigService {
  return {
    get: vi.fn((k: string) => {
      if (k === 'ATTEMPT_ABANDON_AFTER_HOURS') return 24;
      if (k === 'FILL_BLANK_SESSION_SIZE') return 10;
      if (k === 'TIMED_QUIZ_SESSION_SIZE') return 20;
      return undefined;
    }),
    isProd: () => false,
  } as unknown as ConfigService;
}

/**
 * Live-Postgres smoke for the attempts tenant-isolation contract.
 *
 * The contract: a share token resolves to ONE student. Attempts on a
 * different student's games — even on the same tutor — fail with 404,
 * not 401, and never leak data.
 *
 * Skips when DATABASE_URL is unreachable so unit-only runs still pass.
 */
describe('Attempt tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  const config = makeTestConfig();
  const service = new AttemptService(prisma, config, sampleQuestions);
  let tutorId = '';
  let studentA = '';
  let studentB = '';
  let lessonA = '';
  let gameA_assigned = '';
  let gameA_draft = '';
  let dbReady = false;

  const buildPool = () =>
    [
      {
        id: 'q1',
        prompt: 'Q1?',
        answer: 'A1',
        distractors: [],
        acceptAlternates: [],
        topicTags: [],
      },
      {
        id: 'q2',
        prompt: 'Q2?',
        answer: 'A2',
        distractors: [],
        acceptAlternates: [],
        topicTags: [],
      },
    ];

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  beforeEach(async () => {
    if (!dbReady) return;
    const t = await prisma.tutor.create({
      data: { email: `att-iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    tutorId = t.id;
    const a = await prisma.student.create({
      data: { tutorId: t.id, name: 'A', shareToken: `tok-a-${Math.random().toString(36).slice(2, 14)}` },
    });
    const b = await prisma.student.create({
      data: { tutorId: t.id, name: 'B', shareToken: `tok-b-${Math.random().toString(36).slice(2, 14)}` },
    });
    studentA = a.id;
    studentB = b.id;

    const la = await prisma.lesson.create({
      data: {
        studentId: a.id,
        occurredAt: new Date(),
        source: LessonSource.MANUAL,
        feedbackText: 'feedback A',
      },
    });
    lessonA = la.id;

    const assigned = await prisma.game.create({
      data: {
        lessonId: la.id,
        type: GameType.FILL_BLANK,
        title: 'Assigned',
        status: GameStatus.ASSIGNED,
        assignedAt: new Date(),
        questionPool: buildPool() as unknown as object,
        poolSize: 2,
        locale: 'en',
      },
    });
    gameA_assigned = assigned.id;
    const draft = await prisma.game.create({
      data: {
        lessonId: la.id,
        type: GameType.FILL_BLANK,
        title: 'Draft',
        status: GameStatus.DRAFT,
        questionPool: buildPool() as unknown as object,
        poolSize: 2,
        locale: 'en',
      },
    });
    gameA_draft = draft.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { id: tutorId } });
    await prisma.$disconnect();
  });

  it("student B cannot start an attempt on student A's game (404)", async () => {
    if (!dbReady) return;
    const b = await prisma.student.findUnique({ where: { id: studentB } });
    expect(b).not.toBeNull();
    await expect(
      service.startAttempt({ student: b!, gameId: gameA_assigned }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('student A starts attempt on their own game (happy path)', async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    const out = await service.startAttempt({ student: a!, gameId: gameA_assigned });
    expect(out.questions.length).toBeGreaterThan(0);
  });

  it('cannot start attempt on a DRAFT (not ASSIGNED) game even as the owning student', async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    await expect(
      service.startAttempt({ student: a!, gameId: gameA_draft }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("student B cannot PATCH student A's attempt (cross-token 404)", async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    const b = await prisma.student.findUnique({ where: { id: studentB } });
    const started = await service.startAttempt({ student: a!, gameId: gameA_assigned });
    await expect(
      service.submitAnswer({
        student: b!,
        attemptId: started.attempt.id,
        questionId: started.questions[0]!.id,
        rawAnswer: 'whatever',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("student B cannot finish student A's attempt (cross-token 404)", async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    const b = await prisma.student.findUnique({ where: { id: studentB } });
    const started = await service.startAttempt({ student: a!, gameId: gameA_assigned });
    await expect(
      service.finishAttempt({ student: b!, attemptId: started.attempt.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('full happy-path lifecycle: start → answer → finish', async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    const started = await service.startAttempt({ student: a!, gameId: gameA_assigned });
    const first = started.questions[0]!;
    const r1 = await service.submitAnswer({
      student: a!,
      attemptId: started.attempt.id,
      questionId: first.id,
      rawAnswer: first.answer,
    });
    expect(r1.record.correct).toBe(true);
    expect(r1.scoreSoFar).toBe(1);
    const fin = await service.finishAttempt({ student: a!, attemptId: started.attempt.id });
    expect(fin.attempt.finishedAt).toBeInstanceOf(Date);
    // Re-finishing is a no-op (idempotent).
    const fin2 = await service.finishAttempt({ student: a!, attemptId: started.attempt.id });
    expect(fin2.attempt.finishedAt?.getTime()).toBe(fin.attempt.finishedAt?.getTime());
  });

  it("dashboard listing for student B excludes student A's games", async () => {
    if (!dbReady) return;
    const b = await prisma.student.findUnique({ where: { id: studentB } });
    const games = await service.listAssignedGamesForStudent(b!);
    expect(games).toEqual([]);
  });

  it('idempotent answer PATCH does not double-count score', async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    const started = await service.startAttempt({ student: a!, gameId: gameA_assigned });
    const first = started.questions[0]!;
    const r1 = await service.submitAnswer({
      student: a!,
      attemptId: started.attempt.id,
      questionId: first.id,
      rawAnswer: first.answer,
    });
    const r2 = await service.submitAnswer({
      student: a!,
      attemptId: started.attempt.id,
      questionId: first.id,
      rawAnswer: 'totally-different-wrong-answer',
    });
    expect(r2.scoreSoFar).toBe(r1.scoreSoFar);
    expect(r2.record.correct).toBe(true);
  });

  it('finishAbandoned force-finishes attempts older than the threshold', async () => {
    if (!dbReady) return;
    const a = await prisma.student.findUnique({ where: { id: studentA } });
    const started = await service.startAttempt({ student: a!, gameId: gameA_assigned });
    // Backdate startedAt to 48h ago.
    await prisma.attempt.update({
      where: { id: started.attempt.id },
      data: { startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const count = await service.finishAbandoned();
    expect(count).toBeGreaterThanOrEqual(1);
    const after = await prisma.attempt.findUnique({ where: { id: started.attempt.id } });
    expect(after?.finishedAt).not.toBeNull();
    // Use otherwise-unused fixture to keep eslint quiet.
    expect(lessonA).toBeTruthy();
  });
});
