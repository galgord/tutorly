import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { StudentsController, TrashStudentsController, serializeStudent } from './students.controller';
import type { StudentService } from './student.service';

function fakeStudent(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over.id ?? 'stu_1',
    tutorId: over.tutorId ?? 'tutor_a',
    name: (over.name as string | undefined) ?? 'Sara',
    notes: (over.notes as string | null | undefined) ?? null,
    shareToken: (over.shareToken as string | undefined) ?? 'tok-aaaaaaaaaa',
    shareTokenRotatedAt: (over.shareTokenRotatedAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
    createdAt: (over.createdAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: (over.updatedAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
    deletedAt: (over.deletedAt as Date | null | undefined) ?? null,
  };
}

const tutorA: CurrentTutorPayload = { id: 'tutor_a', email: 'a@example.com', name: 'A', locale: 'en' };

function fakeReq(): Request {
  return { ip: '127.0.0.1', header: () => undefined } as unknown as Request;
}

function makeController(overrides: Partial<StudentService> = {}) {
  const students = {
    create: vi.fn().mockResolvedValue(fakeStudent()),
    getForTutorOrFail: vi.fn().mockResolvedValue(fakeStudent()),
    update: vi.fn().mockResolvedValue(fakeStudent()),
    softDelete: vi.fn().mockResolvedValue(fakeStudent({ deletedAt: new Date() })),
    restore: vi.fn().mockResolvedValue(fakeStudent()),
    rotateToken: vi.fn().mockResolvedValue(fakeStudent({ shareToken: 'new-token' })),
    list: vi.fn().mockResolvedValue({ items: [fakeStudent()], total: 1 }),
    listTrash: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    ...overrides,
  } as unknown as StudentService;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { controller: new StudentsController(students, audit), students, audit };
}

describe('StudentsController.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid body', async () => {
    const { controller } = makeController();
    await expect(controller.create(tutorA, { name: '' }, fakeReq() as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('passes tutorId from CurrentTutor (never trusts body)', async () => {
    const { controller, students } = makeController();
    await controller.create(tutorA, { name: 'Sara', tutorId: 'tutor_other' }, fakeReq() as never);
    expect(students.create).toHaveBeenCalledWith({
      tutorId: 'tutor_a',
      name: 'Sara',
      notes: undefined,
    });
  });

  it('audits student.created with the student id', async () => {
    const { controller, audit } = makeController();
    await controller.create(tutorA, { name: 'Sara' }, fakeReq() as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'student.created', entityId: 'stu_1', tutorId: 'tutor_a' }),
    );
  });
});

describe('StudentsController.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes search + pagination + locale to the service', async () => {
    const { controller, students } = makeController();
    await controller.list(tutorA, { q: 'sa', page: '2', limit: '5' });
    expect(students.list).toHaveBeenCalledWith({
      tutorId: 'tutor_a',
      locale: 'en',
      q: 'sa',
      page: 2,
      limit: 5,
    });
  });

  it('rejects nonsense pagination', async () => {
    const { controller } = makeController();
    await expect(controller.list(tutorA, { page: '-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the serialized shape', async () => {
    const { controller } = makeController();
    const res = await controller.list(tutorA, {});
    expect(res.items[0]).toMatchObject({ id: 'stu_1', name: 'Sara' });
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });
});

describe('StudentsController.get / update / delete / restore / rotateToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get returns 404 (NotFoundException) when service throws', async () => {
    const { controller } = makeController({
      getForTutorOrFail: vi.fn().mockRejectedValue(new NotFoundException()),
    });
    await expect(controller.get(tutorA, 'stu_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update validates body', async () => {
    const { controller } = makeController();
    await expect(controller.update(tutorA, 'stu_1', {}, fakeReq() as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('update audits student.updated with field list', async () => {
    const { controller, audit } = makeController();
    await controller.update(tutorA, 'stu_1', { name: 'Sara Z' }, fakeReq() as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'student.updated', metadata: { fields: ['name'] } }),
    );
  });

  it('delete audits and is 204', async () => {
    const { controller, audit } = makeController();
    await controller.remove(tutorA, 'stu_1', fakeReq() as never);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'student.deleted' }));
  });

  it('restore audits student.restored', async () => {
    const { controller, audit } = makeController();
    await controller.restore(tutorA, 'stu_1', fakeReq() as never);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'student.restored' }));
  });

  it('rotateToken returns the new token + audits', async () => {
    const { controller, audit } = makeController();
    const res = await controller.rotateToken(tutorA, 'stu_1', fakeReq() as never);
    expect(res.shareToken).toBe('new-token');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'student.token.rotated' }),
    );
  });
});

describe('TrashStudentsController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists soft-deleted students for the tutor', async () => {
    const students = {
      listTrash: vi.fn().mockResolvedValue({ items: [fakeStudent({ deletedAt: new Date() })], total: 1 }),
    } as unknown as StudentService;
    const controller = new TrashStudentsController(students);
    const res = await controller.list(tutorA, { page: '1', limit: '10' });
    expect(students.listTrash).toHaveBeenCalledWith({
      tutorId: 'tutor_a',
      locale: 'en',
      q: undefined,
      page: 1,
      limit: 10,
    });
    expect(res.items).toHaveLength(1);
  });
});

describe('serializeStudent', () => {
  it('outputs ISO timestamps and never leaks tutorId', () => {
    const out = serializeStudent(fakeStudent({ deletedAt: new Date('2026-04-01T00:00:00Z') }));
    expect(out).toMatchObject({
      id: 'stu_1',
      shareToken: 'tok-aaaaaaaaaa',
      createdAt: '2026-05-01T00:00:00.000Z',
      deletedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(out).not.toHaveProperty('tutorId');
  });
});
