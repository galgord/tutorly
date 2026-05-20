import { GameStatus, GameType, LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { selectAttemptQuestions } from './adaptive-selector';
import { AttemptService } from './attempt.service';
import { StudentGameProgressService } from './student-game-progress.service';

/**
 * Live-Postgres smoke for the Phase 12 cross-play progress contract:
 *  - A finished play writes ONLY the playing student's StudentGameProgress row
 *    (tenant isolation — one share token = one student's progress).
 *  - A high-accuracy play advances the level; the next play starts higher.
 *  - Replays serve non-repeating questions until the unseen pool is drained.
 *
 * Skips when DATABASE_URL is unreachable so unit-only runs still pass.
 */
function makeTestConfig(): ConfigService {
  // Small session size so a 6-question pool yields TWO disjoint plays.
  const values: Record<string, unknown> = {
    ATTEMPT_ABANDON_AFTER_HOURS: 24,
    FILL_BLANK_SESSION_SIZE: 3,
    TIMED_QUIZ_SESSION_SIZE: 20,
    LEVEL_ADVANCE_THRESHOLD: 0.8,
    LEVEL_HOLD_FLOOR: 0.5,
    LEVEL_NUDGE_EVERY_N: 3,
    LEVEL_MIN_SAMPLE: 3,
    LEVEL_ALLOW_DOWN: false,
  };
  return { get: vi.fn((k: string) => values[k]), isProd: () => false } as unknown as ConfigService;
}

describe('StudentGameProgress tenant isolation + cross-play climb (live db)', () => {
  const prisma = new PrismaService();
  const config = makeTestConfig();
  const service = new AttemptService(
    prisma,
    config,
    selectAttemptQuestions,
    new StudentGameProgressService(prisma),
  );

  let tutorId = '';
  let studentA = '';
  let studentB = '';
  let gameId = '';
  let dbReady = false;
  const answerById: Record<string, string> = {};

  const buildPool = () =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      prompt: `Q${i} ___`,
      answer: `ans${i}`,
      distractors: [],
      acceptAlternates: [],
      topicTags: [],
      difficulty: (i % 5) + 1,
    }));

  async function playThrough(
    studentId: string,
    allCorrect: boolean,
  ): Promise<{ questionIds: string[]; level: number; nextLevel: number }> {
    const student = (await prisma.student.findUnique({ where: { id: studentId } }))!;
    const start = await service.startAttempt({ student, gameId });
    for (const q of start.questions) {
      await service.submitAnswer({
        student,
        attemptId: start.attempt.id,
        questionId: q.id,
        rawAnswer: allCorrect ? answerById[q.id] : 'definitely-wrong',
      });
    }
    const fin = await service.finishAttempt({ student, attemptId: start.attempt.id });
    return { questionIds: start.questions.map((q) => q.id), level: start.level, nextLevel: fin.nextLevel };
  }

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
      data: { email: `prog-iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    tutorId = t.id;
    const a = await prisma.student.create({
      data: { tutorId: t.id, name: 'A', shareToken: `ptok-a-${Math.random().toString(36).slice(2, 14)}` },
    });
    const b = await prisma.student.create({
      data: { tutorId: t.id, name: 'B', shareToken: `ptok-b-${Math.random().toString(36).slice(2, 14)}` },
    });
    studentA = a.id;
    studentB = b.id;
    const lesson = await prisma.lesson.create({
      data: { studentId: a.id, occurredAt: new Date(), source: LessonSource.MANUAL, feedbackText: 'fb' },
    });
    const pool = buildPool();
    for (const q of pool) answerById[q.id] = q.answer;
    const game = await prisma.game.create({
      data: {
        lessonId: lesson.id,
        type: GameType.FILL_BLANK,
        title: 'G',
        status: GameStatus.ASSIGNED,
        assignedAt: new Date(),
        questionPool: pool as unknown as object,
        poolSize: pool.length,
        locale: 'en',
      },
    });
    gameId = game.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { id: tutorId } });
    await prisma.$disconnect();
  });

  it('writes only the playing student\'s progress row (B is untouched)', async () => {
    if (!dbReady) return;
    await playThrough(studentA, true);
    const rowA = await prisma.studentGameProgress.findUnique({
      where: { studentId_gameId: { studentId: studentA, gameId } },
    });
    const rowB = await prisma.studentGameProgress.findUnique({
      where: { studentId_gameId: { studentId: studentB, gameId } },
    });
    expect(rowA).not.toBeNull();
    expect(rowA!.playsCompleted).toBe(1);
    expect(rowB).toBeNull();
  });

  it('advances the level on a high-accuracy play; the next play starts higher', async () => {
    if (!dbReady) return;
    const first = await playThrough(studentA, true);
    expect(first.level).toBe(1);
    expect(first.nextLevel).toBe(2);
    const second = await playThrough(studentA, true);
    expect(second.level).toBe(2); // started at the climbed level
    const row = await prisma.studentGameProgress.findUnique({
      where: { studentId_gameId: { studentId: studentA, gameId } },
    });
    expect(row!.currentLevel).toBe(3); // climbed again after the 2nd perfect play
    expect(row!.playsCompleted).toBe(2);
  });

  it('serves non-repeating questions across replays until the unseen pool drains', async () => {
    if (!dbReady) return;
    const first = await playThrough(studentA, true);
    const second = await playThrough(studentA, true);
    // Pool of 6, session size 3 → the two plays must be disjoint.
    const overlap = first.questionIds.filter((id) => second.questionIds.includes(id));
    expect(overlap).toEqual([]);
  });
});
