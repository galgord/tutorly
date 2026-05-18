import { GameStatus, GameType, type Attempt, type Game } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import { ProgressService } from './progress.service';

function fakeAttempt(over: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    gameId: 'g1',
    studentId: 'stu_1',
    score: 0,
    livesLost: 0,
    startedAt: new Date('2026-05-01T00:00:00Z'),
    finishedAt: new Date('2026-05-01T00:05:00Z'),
    questionResults: { results: [] } as never,
    createdAt: new Date(),
    ...over,
  } as Attempt;
}

function fakeGame(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    lessonId: 'l1',
    type: GameType.FILL_BLANK,
    title: 'Verbs',
    status: GameStatus.ASSIGNED,
    questionPool: [] as never,
    poolSize: 10,
    generationPromptHash: null,
    locale: 'en',
    generationError: null,
    deletedAt: null,
    assignedAt: new Date('2026-04-01T00:00:00Z'),
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    ...over,
  } as Game;
}

describe('ProgressService.getStudentProgress', () => {
  it('returns an empty shape when the student has no games or attempts', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.game.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new ProgressService(prisma);

    const out = await svc.getStudentProgress('stu_1');
    expect(out.games).toEqual([]);
    expect(out.topics).toEqual([]);
    expect(out.hardestQuestions).toEqual([]);
    expect(out.totals.totalAttempts).toBe(0);
    expect(out.totals.overallAccuracy).toBeNull();
  });

  it('aggregates rollupGame for each assigned game including zero-attempt ones', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      fakeAttempt({
        questionResults: {
          results: [
            { questionId: 'q1', prompt: 'Q1', correct: true, rawAnswer: 'walks', normalizedAnswer: 'walks', expectedAnswer: 'walks', answeredAt: '2026-05-01T00:01:00Z', topicTags: ['verbs'] },
            { questionId: 'q2', prompt: 'Q2', correct: false, rawAnswer: 'go', normalizedAnswer: 'go', expectedAnswer: 'goes', answeredAt: '2026-05-01T00:02:00Z', topicTags: ['verbs'] },
          ],
        } as never,
      }),
    ]);
    (prisma.game.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      fakeGame({ id: 'g1', title: 'Played' }),
      fakeGame({ id: 'g_unplayed', title: 'Not yet' }),
    ]);
    const svc = new ProgressService(prisma);

    const out = await svc.getStudentProgress('stu_1');
    const played = out.games.find((g) => g.id === 'g1')!;
    const unplayed = out.games.find((g) => g.id === 'g_unplayed')!;
    expect(played.attemptCount).toBe(1);
    expect(played.bestAccuracy).toBe(0.5);
    expect(played.latestAccuracy).toBe(0.5);
    expect(unplayed.attemptCount).toBe(0);
    expect(unplayed.latestAccuracy).toBeNull();

    // Topic + totals
    expect(out.topics.find((t) => t.topic === 'verbs')?.seenCount).toBe(2);
    expect(out.totals.totalQuestionsAnswered).toBe(2);
    expect(out.totals.overallAccuracy).toBe(0.5);
  });

  it('parses the persisted header shape AND the bare-array legacy shape', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      // Phase 6 header shape: { sampledIds, keys, results, ... }
      fakeAttempt({
        id: 'header_shape',
        questionResults: {
          sampledIds: ['q1'],
          keys: {},
          results: [
            { questionId: 'q1', prompt: 'p', correct: true, rawAnswer: 'r', normalizedAnswer: 'n', expectedAnswer: 'e', answeredAt: '2026-05-01T00:00:00Z', topicTags: [] },
          ],
        } as never,
      }),
      // Defensive: bare-array shape used by older fixtures.
      fakeAttempt({
        id: 'array_shape',
        questionResults: [
          { questionId: 'q1', prompt: 'p', correct: false, rawAnswer: '', normalizedAnswer: '', expectedAnswer: 'e', answeredAt: '2026-05-01T00:00:00Z', topicTags: [] },
        ] as never,
      }),
    ]);
    (prisma.game.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([fakeGame()]);
    const svc = new ProgressService(prisma);

    const out = await svc.getStudentProgress('stu_1');
    expect(out.totals.totalQuestionsAnswered).toBe(2);
  });
});

describe('ProgressService.listAttempts', () => {
  it('paginates recent attempts and surfaces monthly aggregates for older ones', async () => {
    const prisma = makePrismaMock();
    const now = new Date('2026-05-18T00:00:00Z');
    const recent = Array.from({ length: 12 }, (_, i) =>
      fakeAttempt({
        id: `recent_${i}`,
        gameId: 'g1',
        startedAt: new Date('2026-05-01T00:00:00Z'),
        questionResults: {
          results: [
            { questionId: 'q1', prompt: 'P', correct: true, rawAnswer: '', normalizedAnswer: '', expectedAnswer: '', answeredAt: '2026-05-01T00:00:00Z', topicTags: [] },
            { questionId: 'q2', prompt: 'P', correct: false, rawAnswer: '', normalizedAnswer: '', expectedAnswer: '', answeredAt: '2026-05-01T00:00:00Z', topicTags: [] },
          ],
        } as never,
      }),
    );
    const ancient = [
      fakeAttempt({
        id: 'ancient_1',
        startedAt: new Date('2025-10-01T00:00:00Z'),
        questionResults: { results: [{ questionId: 'q', prompt: 'P', correct: true, rawAnswer: '', normalizedAnswer: '', expectedAnswer: '', answeredAt: '2025-10-01T00:00:00Z', topicTags: [] }] } as never,
      }),
      fakeAttempt({
        id: 'ancient_2',
        startedAt: new Date('2025-10-15T00:00:00Z'),
        questionResults: { results: [{ questionId: 'q', prompt: 'P', correct: false, rawAnswer: '', normalizedAnswer: '', expectedAnswer: '', answeredAt: '2025-10-15T00:00:00Z', topicTags: [] }] } as never,
      }),
    ];
    (prisma.attempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      [...recent, ...ancient].map((a) => ({ ...a, game: { id: 'g1', title: 'Verbs', type: GameType.FILL_BLANK } })),
    );

    const svc = new ProgressService(prisma);
    const page1 = await svc.listAttempts({ studentId: 'stu_1', page: 1, limit: 10, now });
    expect(page1.items.length).toBe(10);
    expect(page1.totalRecent).toBe(12);
    expect(page1.hasMore).toBe(true);
    expect(page1.monthlyAggregates).toEqual([
      { month: '2025-10', attemptCount: 2, avgAccuracy: 0.5 },
    ]);

    const page2 = await svc.listAttempts({ studentId: 'stu_1', page: 2, limit: 10, now });
    expect(page2.items.length).toBe(2);
    expect(page2.hasMore).toBe(false);
  });

  it('returns empty monthlyAggregates when nothing is older than the cutoff', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...fakeAttempt(), game: { id: 'g1', title: 'Verbs', type: GameType.FILL_BLANK } },
    ]);
    const svc = new ProgressService(prisma);
    const out = await svc.listAttempts({ studentId: 'stu_1', page: 1, limit: 10, now: new Date('2026-05-18T00:00:00Z') });
    expect(out.monthlyAggregates).toEqual([]);
    expect(out.items[0]?.gameTitle).toBe('Verbs');
  });
});
