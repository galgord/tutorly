import { NotFoundException } from '@nestjs/common';
import { GameStatus, GameType, LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { StudentService } from '../students/student.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

/**
 * Phase 7 progress tenant-isolation contract: tutor A asking for tutor B's
 * student's progress / attempts gets 404 (never 401, never empty-array,
 * which would leak existence).
 *
 * Also asserts the aggregation surfaces real data for the rightful tutor.
 *
 * Skipped when DATABASE_URL is unreachable.
 */
describe('Progress tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  const students = new StudentService(prisma);
  const progress = new ProgressService(prisma);
  const config = {
    get: vi.fn((k: string) => {
      if (k === 'GAME_GEN_MONTHLY_CAP') return 100;
      if (k === 'WHISPER_MONTHLY_MINUTES_CAP') return 60;
      if (k === 'GAME_GEN_TOPUP_MONTHLY_CAP') return 50;
      return undefined;
    }),
    isProd: () => false,
  } as unknown as ConfigService;
  const quota = new QuotaService(prisma, config, new AuditService(prisma));
  const controller = new ProgressController(students, progress, quota);

  let tutorAId = '';
  let tutorBId = '';
  let studentA = '';
  let studentB = '';
  let gameA = '';
  let dbReady = false;

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
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const a = await prisma.tutor.create({ data: { email: `prog-a-${suffix}@example.com` } });
    const b = await prisma.tutor.create({ data: { email: `prog-b-${suffix}@example.com` } });
    tutorAId = a.id;
    tutorBId = b.id;

    const sa = await prisma.student.create({
      data: { tutorId: a.id, name: 'A', shareToken: `tok-a-${suffix}` },
    });
    const sb = await prisma.student.create({
      data: { tutorId: b.id, name: 'B', shareToken: `tok-b-${suffix}` },
    });
    studentA = sa.id;
    studentB = sb.id;

    const la = await prisma.lesson.create({
      data: {
        studentId: sa.id,
        occurredAt: new Date(),
        source: LessonSource.MANUAL,
        feedbackText: 'fb',
      },
    });

    const game = await prisma.game.create({
      data: {
        lessonId: la.id,
        type: GameType.FILL_BLANK,
        title: 'Verbs',
        status: GameStatus.ASSIGNED,
        assignedAt: new Date(),
        questionPool: [] as unknown as object,
        poolSize: 1,
        locale: 'en',
      },
    });
    gameA = game.id;

    // One completed attempt with one correct + one wrong answer.
    await prisma.attempt.create({
      data: {
        gameId: game.id,
        studentId: sa.id,
        score: 1,
        livesLost: 0,
        startedAt: new Date('2026-05-01T00:00:00Z'),
        finishedAt: new Date('2026-05-01T00:05:00Z'),
        questionResults: {
          results: [
            {
              questionId: 'q1',
              prompt: 'She ___ to school.',
              correct: true,
              rawAnswer: 'walks',
              normalizedAnswer: 'walks',
              expectedAnswer: 'walks',
              answeredAt: '2026-05-01T00:01:00Z',
              topicTags: ['verbs'],
            },
            {
              questionId: 'q2',
              prompt: 'He ___ home.',
              correct: false,
              rawAnswer: 'go',
              normalizedAnswer: 'go',
              expectedAnswer: 'goes',
              answeredAt: '2026-05-01T00:02:00Z',
              topicTags: ['verbs'],
            },
          ],
        } as unknown as object,
      },
    });
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.$disconnect();
  });

  it('tutor A reads their own student\'s progress + attempts', async () => {
    if (!dbReady) return;
    const prog = await controller.getProgress({ id: tutorAId, email: 'a@x' }, studentA);
    expect(prog.studentId).toBe(studentA);
    expect(prog.totals.totalQuestionsAnswered).toBe(2);
    expect(prog.totals.overallAccuracy).toBe(0.5);
    expect(prog.games).toHaveLength(1);
    expect(prog.games[0]?.id).toBe(gameA);
    expect(prog.games[0]?.attemptCount).toBe(1);

    const list = await controller.listAttempts({ id: tutorAId, email: 'a@x' }, studentA, {});
    expect(list.items.length).toBe(1);
    expect(list.items[0]?.gameTitle).toBe('Verbs');
    expect(list.items[0]?.results.length).toBe(2);
  });

  it('tutor B cannot read tutor A\'s student\'s progress (404)', async () => {
    if (!dbReady) return;
    await expect(
      controller.getProgress({ id: tutorBId, email: 'b@x' }, studentA),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.listAttempts({ id: tutorBId, email: 'b@x' }, studentA, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tutor A reads their student\'s adaptive game-progress; tutor B is refused (404)', async () => {
    if (!dbReady) return;
    const gp = await controller.getGameProgress({ id: tutorAId, email: 'a@x' }, studentA);
    expect(gp.games).toHaveLength(1);
    expect(gp.games[0]?.gameId).toBe(gameA);
    expect(gp.games[0]?.currentLevel).toBe(1); // never leveled → default
    expect(gp.budget).toMatchObject({ topUpCap: 50 });

    await expect(
      controller.getGameProgress({ id: tutorBId, email: 'b@x' }, studentA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tutor B can read their own student\'s empty progress', async () => {
    if (!dbReady) return;
    const prog = await controller.getProgress({ id: tutorBId, email: 'b@x' }, studentB);
    expect(prog.games).toEqual([]);
    expect(prog.totals.totalAttempts).toBe(0);
  });

  it('404 on an unknown student id (no existence leak)', async () => {
    if (!dbReady) return;
    await expect(
      controller.getProgress({ id: tutorAId, email: 'a@x' }, 'stu_does_not_exist'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
