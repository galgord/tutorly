import { GameType, type Student } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttemptService } from './attempt.service';
import { PublicStudentDashboardController } from './public-student-dashboard.controller';

function fakeStudent(over: Partial<Student> = {}): Student {
  return {
    id: 'stu_1',
    tutorId: 't',
    name: 'Sara',
    notes: null,
    shareToken: 'tok',
    shareTokenRotatedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Student;
}

describe('PublicStudentDashboardController', () => {
  let attempts: { listAssignedGamesForStudent: ReturnType<typeof vi.fn> } & AttemptService;
  let controller: PublicStudentDashboardController;

  beforeEach(() => {
    attempts = {
      listAssignedGamesForStudent: vi.fn(),
    } as unknown as typeof attempts;
    controller = new PublicStudentDashboardController(attempts);
  });

  it('returns the student name + games projection', async () => {
    attempts.listAssignedGamesForStudent.mockResolvedValue([
      {
        game: {
          id: 'g1',
          type: GameType.FILL_BLANK,
          title: 'Practice',
          locale: 'en',
          poolSize: 10,
        },
        lastPlayedAt: new Date('2026-05-15T12:00:00Z'),
        bestScore: 7,
      },
      {
        game: {
          id: 'g2',
          type: GameType.TIMED_QUIZ,
          title: 'Quiz',
          locale: 'he',
          poolSize: 20,
        },
        lastPlayedAt: null,
        bestScore: null,
      },
    ]);
    const req = { student: fakeStudent({ name: 'Sara C.' }) } as never;
    const out = await controller.getDashboard(req);
    expect(out.name).toBe('Sara C.');
    expect(out.games).toEqual([
      {
        id: 'g1',
        type: 'FILL_BLANK',
        title: 'Practice',
        locale: 'en',
        poolSize: 10,
        lastPlayedAt: '2026-05-15T12:00:00.000Z',
        bestScore: 7,
      },
      {
        id: 'g2',
        type: 'TIMED_QUIZ',
        title: 'Quiz',
        locale: 'he',
        poolSize: 20,
        lastPlayedAt: null,
        bestScore: null,
      },
    ]);
  });

  it('returns empty games array when student has nothing assigned', async () => {
    attempts.listAssignedGamesForStudent.mockResolvedValue([]);
    const req = { student: fakeStudent() } as never;
    const out = await controller.getDashboard(req);
    expect(out.games).toEqual([]);
  });
});
