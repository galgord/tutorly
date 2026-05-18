import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicStudentController } from './public-student.controller';
import { StudentTokenGuard, type StudentTokenRequest } from './student-token.guard';
import type { StudentService } from './student.service';

function fakeStudent(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over.id ?? 'stu_1',
    tutorId: 'tutor_a',
    name: (over.name as string | undefined) ?? 'Sara',
    notes: null,
    shareToken: (over.shareToken as string | undefined) ?? 'tok',
    shareTokenRotatedAt: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    deletedAt: (over.deletedAt as Date | null | undefined) ?? null,
  };
}

function fakeCtx(params: Record<string, string>, req?: Partial<StudentTokenRequest>): ExecutionContext {
  const r: StudentTokenRequest = { params, ...req } as StudentTokenRequest;
  return {
    switchToHttp: () => ({ getRequest: <T>() => r as unknown as T }),
  } as ExecutionContext;
}

describe('StudentTokenGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when no token in params', async () => {
    const students = { findByShareToken: vi.fn() } as unknown as StudentService;
    const guard = new StudentTokenGuard(students);
    await expect(guard.canActivate(fakeCtx({}))).rejects.toBeInstanceOf(NotFoundException);
    expect(students.findByShareToken).not.toHaveBeenCalled();
  });

  it('throws 404 when token unknown', async () => {
    const students = { findByShareToken: vi.fn().mockResolvedValue(null) } as unknown as StudentService;
    const guard = new StudentTokenGuard(students);
    await expect(guard.canActivate(fakeCtx({ shareToken: 'nope' }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 404 for soft-deleted (service returns null because of where-clause)', async () => {
    const students = { findByShareToken: vi.fn().mockResolvedValue(null) } as unknown as StudentService;
    const guard = new StudentTokenGuard(students);
    await expect(guard.canActivate(fakeCtx({ shareToken: 'tok' }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('attaches student on success', async () => {
    const students = {
      findByShareToken: vi.fn().mockResolvedValue(fakeStudent()),
    } as unknown as StudentService;
    const guard = new StudentTokenGuard(students);
    const req: Partial<StudentTokenRequest> = {};
    const ctx = fakeCtx({ shareToken: 'tok' }, req);
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    // Re-read via the same context
    const actualReq = ctx.switchToHttp().getRequest<StudentTokenRequest>();
    expect(actualReq.student?.name).toBe('Sara');
  });
});

describe('PublicStudentController', () => {
  it('returns just the student name', () => {
    const controller = new PublicStudentController();
    const req = { student: fakeStudent({ name: 'Sara Cohen' }) } as StudentTokenRequest;
    expect(controller.getStudent(req)).toEqual({ name: 'Sara Cohen' });
  });
});
