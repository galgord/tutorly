import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Student } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentService } from '../students/student.service';
import { ProgressController } from './progress.controller';
import type { ProgressService } from './progress.service';

const tutor = { id: 't1', email: 'a@b.c' };

function fakeStudent(): Student {
  return {
    id: 'stu_1',
    tutorId: 't1',
    name: 'A',
    notes: null,
    shareToken: 'tok',
    shareTokenRotatedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Student;
}

describe('ProgressController', () => {
  let students: { getForTutorOrFail: ReturnType<typeof vi.fn> } & StudentService;
  let progress: { getStudentProgress: ReturnType<typeof vi.fn>; listAttempts: ReturnType<typeof vi.fn> } & ProgressService;
  let controller: ProgressController;

  beforeEach(() => {
    students = { getForTutorOrFail: vi.fn().mockResolvedValue(fakeStudent()) } as unknown as typeof students;
    progress = {
      getStudentProgress: vi.fn(),
      listAttempts: vi.fn(),
    } as unknown as typeof progress;
    controller = new ProgressController(students, progress);
  });

  describe('GET /students/:id/progress', () => {
    it('verifies tutor ownership then returns the aggregate', async () => {
      progress.getStudentProgress.mockResolvedValue({
        studentId: 'stu_1',
        totals: {
          totalAttempts: 0,
          completedAttempts: 0,
          totalQuestionsAnswered: 0,
          overallAccuracy: null,
          firstAttemptAt: null,
          lastAttemptAt: null,
        },
        games: [],
        topics: [],
        hardestQuestions: [],
      });
      const out = await controller.getProgress(tutor, 'stu_1');
      expect(students.getForTutorOrFail).toHaveBeenCalledWith({ id: 'stu_1', tutorId: 't1' });
      expect(progress.getStudentProgress).toHaveBeenCalledWith('stu_1');
      expect(out.studentId).toBe('stu_1');
    });

    it('404s when the student is not the tutor\'s', async () => {
      students.getForTutorOrFail.mockRejectedValue(new NotFoundException('Student not found.'));
      await expect(controller.getProgress(tutor, 'stu_other')).rejects.toBeInstanceOf(NotFoundException);
      expect(progress.getStudentProgress).not.toHaveBeenCalled();
    });
  });

  describe('GET /students/:id/attempts', () => {
    it('400 on bad query params', async () => {
      await expect(controller.listAttempts(tutor, 'stu_1', { page: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults page=1 limit=10 and respects values', async () => {
      progress.listAttempts.mockResolvedValue({
        items: [],
        page: 1,
        limit: 10,
        totalRecent: 0,
        hasMore: false,
        monthlyAggregates: [],
        monthlyCutoff: new Date().toISOString(),
      });
      await controller.listAttempts(tutor, 'stu_1', {});
      expect(progress.listAttempts).toHaveBeenCalledWith({
        studentId: 'stu_1',
        page: 1,
        limit: 10,
      });

      progress.listAttempts.mockClear();
      await controller.listAttempts(tutor, 'stu_1', { page: '2', limit: '25' });
      expect(progress.listAttempts).toHaveBeenCalledWith({
        studentId: 'stu_1',
        page: 2,
        limit: 25,
      });
    });

    it('caps limit at the schema maximum (50)', async () => {
      await expect(controller.listAttempts(tutor, 'stu_1', { limit: '500' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the student is not the tutor\'s', async () => {
      students.getForTutorOrFail.mockRejectedValue(new NotFoundException('Student not found.'));
      await expect(controller.listAttempts(tutor, 'stu_x', { page: '1' })).rejects.toBeInstanceOf(NotFoundException);
      expect(progress.listAttempts).not.toHaveBeenCalled();
    });
  });
});
