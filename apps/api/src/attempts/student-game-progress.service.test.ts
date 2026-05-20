import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import { StudentGameProgressService } from './student-game-progress.service';

describe('StudentGameProgressService.loadState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to level 1 / nothing-seen when no row exists', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.studentGameProgress.findUnique).mockResolvedValue(null as never);
    const svc = new StudentGameProgressService(prisma);
    const state = await svc.loadState('stu_1', 'game_1');
    expect(state).toEqual({ level: 1, seen: [], nudgeCounter: 0 });
  });

  it('returns the stored level, seen ids, and nudge counter', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.studentGameProgress.findUnique).mockResolvedValue({
      currentLevel: 4,
      seenQuestionIds: ['q1', 'q2'],
      nudgeCounter: 2,
    } as never);
    const svc = new StudentGameProgressService(prisma);
    const state = await svc.loadState('stu_1', 'game_1');
    expect(state).toEqual({ level: 4, seen: ['q1', 'q2'], nudgeCounter: 2 });
  });
});

describe('StudentGameProgressService.applyFinish', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts with atomic increment + array push and a deduped create seed', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.studentGameProgress.upsert).mockResolvedValue({} as never);
    const svc = new StudentGameProgressService(prisma);
    const now = new Date('2026-05-20T10:00:00Z');

    await svc.applyFinish({
      studentId: 'stu_1',
      gameId: 'game_1',
      newLevel: 3,
      nudgeCounter: 0,
      lastLevelDelta: 1,
      lastAccuracy: 0.9,
      newlyAnsweredIds: ['q1', 'q1', 'q2'], // dup in input
      now,
    });

    const call = vi.mocked(prisma.studentGameProgress.upsert).mock.calls[0]![0];
    expect(call.where).toEqual({ studentId_gameId: { studentId: 'stu_1', gameId: 'game_1' } });
    // Create branch dedupes the seed set.
    expect(call.create).toMatchObject({
      studentId: 'stu_1',
      gameId: 'game_1',
      currentLevel: 3,
      playsCompleted: 1,
      seenQuestionIds: ['q1', 'q2'],
      lastAccuracy: 0.9,
      lastLevelDelta: 1,
      lastPlayedAt: now,
    });
    // Update branch uses atomic ops (no lost updates under concurrency).
    expect(call.update).toMatchObject({
      currentLevel: 3,
      playsCompleted: { increment: 1 },
      seenQuestionIds: { push: ['q1', 'q1', 'q2'] },
      lastAccuracy: 0.9,
      lastLevelDelta: 1,
    });
  });

  it('persists a null accuracy when nothing countable was answered', async () => {
    const prisma = makePrismaMock();
    vi.mocked(prisma.studentGameProgress.upsert).mockResolvedValue({} as never);
    const svc = new StudentGameProgressService(prisma);
    await svc.applyFinish({
      studentId: 'stu_1',
      gameId: 'game_1',
      newLevel: 1,
      nudgeCounter: 0,
      lastLevelDelta: 0,
      lastAccuracy: null,
      newlyAnsweredIds: [],
    });
    const call = vi.mocked(prisma.studentGameProgress.upsert).mock.calls[0]![0];
    expect(call.create).toMatchObject({ lastAccuracy: null, seenQuestionIds: [] });
  });
});
