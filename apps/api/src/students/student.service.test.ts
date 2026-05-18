import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import type { PrismaService } from '../prisma/prisma.service';
import { SOFT_DELETE_GRACE_MS, StudentService } from './student.service';

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

function makeService() {
  const prisma = makePrismaMock();
  const service = new StudentService(prisma);
  return { service, prisma };
}

describe('StudentService.findForTutor / getForTutorOrFail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes by tutorId — returns null on cross-tenant id', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
    const got = await service.findForTutor({ id: 'stu_1', tutorId: 'tutor_b' });
    expect(got).toBeNull();
    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: { id: 'stu_1', tutorId: 'tutor_b', deletedAt: null },
    });
  });

  it('getForTutorOrFail throws NotFoundException (NOT 401) for cross-tenant lookup', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
    await expect(service.getForTutorOrFail({ id: 'stu_1', tutorId: 'tutor_b' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the student when scoped match found', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent() as never);
    const got = await service.getForTutorOrFail({ id: 'stu_1', tutorId: 'tutor_a' });
    expect(got.id).toBe('stu_1');
  });

  it('includeDeleted broadens the scope', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
    await service.findForTutor({ id: 'stu_1', tutorId: 'tutor_a', includeDeleted: true });
    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: { id: 'stu_1', tutorId: 'tutor_a' },
    });
  });
});

describe('StudentService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates with a freshly-generated 256-bit share token', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.create).mockResolvedValue(fakeStudent() as never);

    await service.create({ tutorId: 'tutor_a', name: 'Sara', notes: 'shy' });
    const args = vi.mocked(prisma.student.create).mock.calls[0]?.[0];
    expect(args?.data.tutorId).toBe('tutor_a');
    expect(args?.data.name).toBe('Sara');
    expect(args?.data.notes).toBe('shy');
    // 32 random bytes → 43-char base64url.
    expect(args?.data.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args?.data.shareTokenRotatedAt).toBeInstanceOf(Date);
  });

  it('normalizes empty/whitespace notes to null', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.create).mockResolvedValue(fakeStudent() as never);
    await service.create({ tutorId: 'tutor_a', name: 'Sara', notes: '   ' });
    expect(vi.mocked(prisma.student.create).mock.calls[0]?.[0].data.notes).toBeNull();
  });

  it('treats undefined notes as null', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.create).mockResolvedValue(fakeStudent() as never);
    await service.create({ tutorId: 'tutor_a', name: 'Sara' });
    expect(vi.mocked(prisma.student.create).mock.calls[0]?.[0].data.notes).toBeNull();
  });
});

describe('StudentService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses cross-tenant update (404 before update issued)', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
    await expect(
      service.update({ id: 'stu_1', tutorId: 'tutor_b', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('updates name only when notes omitted', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent() as never);
    vi.mocked(prisma.student.update).mockResolvedValue(fakeStudent({ name: 'New' }) as never);
    await service.update({ id: 'stu_1', tutorId: 'tutor_a', name: 'New' });
    expect(prisma.student.update).toHaveBeenCalledWith({
      where: { id: 'stu_1' },
      data: { name: 'New', notes: undefined },
    });
  });

  it('allows explicit null to clear notes', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent() as never);
    vi.mocked(prisma.student.update).mockResolvedValue(fakeStudent() as never);
    await service.update({ id: 'stu_1', tutorId: 'tutor_a', notes: null });
    expect(prisma.student.update).toHaveBeenCalledWith({
      where: { id: 'stu_1' },
      data: { name: undefined, notes: null },
    });
  });
});

describe('StudentService.softDelete / restore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-delete sets deletedAt', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent() as never);
    vi.mocked(prisma.student.update).mockResolvedValue(fakeStudent() as never);
    await service.softDelete({ id: 'stu_1', tutorId: 'tutor_a' });
    const args = vi.mocked(prisma.student.update).mock.calls[0]?.[0];
    expect(args?.data.deletedAt).toBeInstanceOf(Date);
  });

  it('restore clears deletedAt within grace', async () => {
    const { service, prisma } = makeService();
    const deletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5d ago
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent({ deletedAt }) as never);
    vi.mocked(prisma.student.update).mockResolvedValue(fakeStudent({ deletedAt: null }) as never);
    await service.restore({ id: 'stu_1', tutorId: 'tutor_a' });
    expect(vi.mocked(prisma.student.update).mock.calls[0]?.[0].data).toEqual({ deletedAt: null });
  });

  it('restore is a no-op when student is already live', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent({ deletedAt: null }) as never);
    await service.restore({ id: 'stu_1', tutorId: 'tutor_a' });
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('restore refuses outside the grace window', async () => {
    const { service, prisma } = makeService();
    const deletedAt = new Date(Date.now() - SOFT_DELETE_GRACE_MS - 60_000);
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent({ deletedAt }) as never);
    await expect(service.restore({ id: 'stu_1', tutorId: 'tutor_a' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('restore refuses cross-tenant', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
    await expect(service.restore({ id: 'stu_1', tutorId: 'tutor_b' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StudentService.rotateToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('changes the share token to a new 43-char value', async () => {
    const { service, prisma } = makeService();
    const before = fakeStudent({ shareToken: 'old-token-aaaaaaaaaa' });
    vi.mocked(prisma.student.findFirst).mockResolvedValue(before as never);
    vi.mocked(prisma.student.update).mockResolvedValue(
      fakeStudent({ shareToken: 'new' }) as never,
    );
    await service.rotateToken({ id: 'stu_1', tutorId: 'tutor_a' });
    const data = vi.mocked(prisma.student.update).mock.calls[0]?.[0].data;
    expect(data?.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data?.shareToken).not.toBe('old-token-aaaaaaaaaa');
    expect(data?.shareTokenRotatedAt).toBeInstanceOf(Date);
  });

  it('refuses cross-tenant rotation', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
    await expect(service.rotateToken({ id: 'stu_1', tutorId: 'tutor_b' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StudentService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  function bindList(prisma: PrismaService, items: Array<ReturnType<typeof fakeStudent>>, total = items.length) {
    vi.mocked(prisma.student.findMany).mockResolvedValue(items as never);
    vi.mocked(prisma.student.count).mockResolvedValue(total as never);
  }

  it('scopes by tutorId, filters out deleted, paginates', async () => {
    const { service, prisma } = makeService();
    bindList(prisma, [fakeStudent({ name: 'Alice' }), fakeStudent({ name: 'Bob' })], 2);
    await service.list({ tutorId: 'tutor_a', page: 2, limit: 5, locale: 'en' });
    const findArgs = vi.mocked(prisma.student.findMany).mock.calls[0]?.[0];
    expect(findArgs?.where).toEqual({ tutorId: 'tutor_a', deletedAt: null });
    expect(findArgs?.skip).toBe(5);
    expect(findArgs?.take).toBe(5);
  });

  it('applies case-insensitive search by name when q present', async () => {
    const { service, prisma } = makeService();
    bindList(prisma, []);
    await service.list({ tutorId: 'tutor_a', page: 1, limit: 10, q: 'sa', locale: 'en' });
    const where = vi.mocked(prisma.student.findMany).mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.name).toEqual({ contains: 'sa', mode: 'insensitive' });
  });

  it('locale-aware sort orders accented names correctly (pt)', async () => {
    const { service, prisma } = makeService();
    // DB returns name-asc; service then re-sorts via Intl.Collator.
    bindList(prisma, [fakeStudent({ name: 'André' }), fakeStudent({ name: 'Bruno' }), fakeStudent({ name: 'Ângela' })]);
    const { items } = await service.list({ tutorId: 'tutor_a', page: 1, limit: 10, locale: 'pt' });
    const names = items.map((s) => s.name);
    // Ângela and André collate adjacent regardless of accents in pt.
    expect(names[0]).toMatch(/^(Ângela|André)$/);
    expect(names[2]).toBe('Bruno');
  });
});

describe('StudentService.listTrash', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only returns deleted-within-grace, scoped by tutor', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.student.count).mockResolvedValue(0 as never);
    await service.listTrash({ tutorId: 'tutor_a', page: 1, limit: 10, locale: 'en' });
    const where = vi.mocked(prisma.student.findMany).mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.tutorId).toBe('tutor_a');
    // deletedAt: { not: null, gte: <cutoff> }
    expect(where.deletedAt).toMatchObject({ not: null, gte: expect.any(Date) });
  });
});

describe('StudentService.findByShareToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null on empty token without hitting db', async () => {
    const { service, prisma } = makeService();
    const got = await service.findByShareToken('');
    expect(got).toBeNull();
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it('looks up by token AND excludes soft-deleted', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(fakeStudent() as never);
    await service.findByShareToken('tok');
    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: { shareToken: 'tok', deletedAt: null },
    });
  });
});

describe('StudentService.hardDeleteExpired', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes students whose grace has elapsed and returns count', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.student.deleteMany).mockResolvedValue({ count: 4 } as never);
    const n = await service.hardDeleteExpired();
    expect(n).toBe(4);
    const args = vi.mocked(prisma.student.deleteMany).mock.calls[0]?.[0];
    expect(args?.where?.deletedAt).toMatchObject({ lt: expect.any(Date) });
  });
});
