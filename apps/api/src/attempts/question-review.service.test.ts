import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import { DEFAULT_SR_INTERVALS_DAYS } from './leitner';
import { QuestionReviewService } from './question-review.service';

const intervals = DEFAULT_SR_INTERVALS_DAYS;

describe('QuestionReviewService.dueReviews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns due questionIds ordered by dueAt (oldest first)', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.questionReview.findMany).mockResolvedValue([
      { questionId: 'q3' },
      { questionId: 'q1' },
    ] as never);
    const svc = new QuestionReviewService(prisma);
    const now = new Date('2026-05-20T00:00:00Z');
    const ids = await svc.dueReviews({ studentId: 'stu_1', gameId: 'game_1', now, limit: 5 });
    expect(ids).toEqual(['q3', 'q1']);
    const call = vi.mocked(prisma.questionReview.findMany).mock.calls[0]![0];
    expect(call.where).toMatchObject({ studentId: 'stu_1', gameId: 'game_1', dueAt: { lte: now } });
    expect(call.orderBy).toEqual({ dueAt: 'asc' });
    expect(call.take).toBe(5);
  });
});

describe('QuestionReviewService.recordResults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a box-1 row for a NEW wrong question (due immediately)', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.questionReview.findMany).mockResolvedValue([] as never); // no existing rows
    vi.mocked(prisma.questionReview.upsert).mockResolvedValue({} as never);
    const svc = new QuestionReviewService(prisma);
    const now = new Date('2026-05-20T00:00:00Z');
    await svc.recordResults({
      studentId: 'stu_1',
      gameId: 'game_1',
      results: [{ questionId: 'q1', correct: false }],
      intervals,
      now,
    });
    const call = vi.mocked(prisma.questionReview.upsert).mock.calls[0]![0];
    expect(call.create).toMatchObject({
      questionId: 'q1',
      box: 1,
      lastResult: false,
      timesSeen: 1,
      timesWrong: 1,
    });
    expect((call.create.dueAt as Date).getTime()).toBe(now.getTime()); // box-1 interval = 0 days
  });

  it('promotes the box for a correct answer to an EXISTING review (atomic counters)', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.questionReview.findMany).mockResolvedValue([
      { questionId: 'q1', box: 2 },
    ] as never);
    vi.mocked(prisma.questionReview.upsert).mockResolvedValue({} as never);
    const svc = new QuestionReviewService(prisma);
    const now = new Date('2026-05-20T00:00:00Z');
    await svc.recordResults({
      studentId: 'stu_1',
      gameId: 'game_1',
      results: [{ questionId: 'q1', correct: true }],
      intervals,
      now,
    });
    const call = vi.mocked(prisma.questionReview.upsert).mock.calls[0]![0];
    expect(call.update).toMatchObject({
      box: 3, // 2 → 3
      lastResult: true,
      timesSeen: { increment: 1 },
    });
    // Correct answer does NOT bump timesWrong.
    expect(call.update.timesWrong).toBeUndefined();
    // box 3 → interval index 2 → 3 days.
    expect((call.update.dueAt as Date).toISOString()).toBe('2026-05-23T00:00:00.000Z');
  });

  it('is a no-op for an empty result set (no DB calls)', async () => {
    const prisma = makePrismaMock();
    const svc = new QuestionReviewService(prisma);
    await svc.recordResults({ studentId: 'stu_1', gameId: 'game_1', results: [], intervals });
    expect(prisma.questionReview.findMany).not.toHaveBeenCalled();
    expect(prisma.questionReview.upsert).not.toHaveBeenCalled();
  });
});
