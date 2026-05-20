import { GameStatus, GameType, LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SR_INTERVALS_DAYS } from './leitner';
import { QuestionReviewService } from './question-review.service';

/**
 * Live-Postgres smoke for QuestionReview tenant isolation. Reviews are scoped
 * to one (student, game); another student — even under the same tutor and the
 * same game — must never see student A's due reviews.
 *
 * Skips when DATABASE_URL is unreachable so unit-only runs still pass.
 */
describe('QuestionReview tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  const svc = new QuestionReviewService(prisma);
  let tutorId = '';
  let studentA = '';
  let studentB = '';
  let gameId = '';
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
    const t = await prisma.tutor.create({
      data: { email: `qr-iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    tutorId = t.id;
    const a = await prisma.student.create({
      data: { tutorId: t.id, name: 'A', shareToken: `qra-${Math.random().toString(36).slice(2, 14)}` },
    });
    const b = await prisma.student.create({
      data: { tutorId: t.id, name: 'B', shareToken: `qrb-${Math.random().toString(36).slice(2, 14)}` },
    });
    studentA = a.id;
    studentB = b.id;
    const lesson = await prisma.lesson.create({
      data: { studentId: a.id, occurredAt: new Date(), source: LessonSource.MANUAL, feedbackText: 'fb' },
    });
    const game = await prisma.game.create({
      data: {
        lessonId: lesson.id,
        type: GameType.FILL_BLANK,
        title: 'G',
        status: GameStatus.ASSIGNED,
        questionPool: [] as unknown as object,
        poolSize: 0,
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

  it('records reviews for one student without leaking them to another', async () => {
    if (!dbReady) return;
    const now = new Date();
    await svc.recordResults({
      studentId: studentA,
      gameId,
      results: [
        { questionId: 'q1', correct: false },
        { questionId: 'q2', correct: false },
      ],
      intervals: DEFAULT_SR_INTERVALS_DAYS,
      now,
    });

    const dueA = await svc.dueReviews({ studentId: studentA, gameId, now });
    const dueB = await svc.dueReviews({ studentId: studentB, gameId, now });

    expect(new Set(dueA)).toEqual(new Set(['q1', 'q2']));
    expect(dueB).toEqual([]); // cross-student isolation
  });

  it('does not surface a review on a different game', async () => {
    if (!dbReady) return;
    const now = new Date();
    await svc.recordResults({
      studentId: studentA,
      gameId,
      results: [{ questionId: 'q1', correct: false }],
      intervals: DEFAULT_SR_INTERVALS_DAYS,
      now,
    });
    const dueOtherGame = await svc.dueReviews({ studentId: studentA, gameId: 'some-other-game', now });
    expect(dueOtherGame).toEqual([]);
  });

  it('a correctly-answered new question is NOT due immediately (box 2)', async () => {
    if (!dbReady) return;
    const now = new Date();
    await svc.recordResults({
      studentId: studentA,
      gameId,
      results: [{ questionId: 'q1', correct: true }],
      intervals: DEFAULT_SR_INTERVALS_DAYS,
      now,
    });
    const dueNow = await svc.dueReviews({ studentId: studentA, gameId, now });
    expect(dueNow).toEqual([]); // box 2 → due in 1 day, not now
  });
});
