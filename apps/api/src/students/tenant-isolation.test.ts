import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { StudentService } from './student.service';

/**
 * Smoke test of the tenant-isolation contract against a real Postgres.
 * Asserts: tutor B can never load / mutate tutor A's student via the service
 * surface — the failure mode is always a NotFoundException, never silent
 * success and never a 401-shaped error.
 *
 * Skips automatically if DATABASE_URL is not reachable so unit-only runs
 * still pass.
 */
describe('Student tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  let service: StudentService;
  let tutorA = '';
  let tutorB = '';
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    service = new StudentService(prisma);
  });

  beforeEach(async () => {
    if (!dbReady) return;
    // Fresh tutors per run to keep tests isolated from each other.
    const a = await prisma.tutor.create({
      data: { email: `iso-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const b = await prisma.tutor.create({
      data: { email: `iso-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    tutorA = a.id;
    tutorB = b.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { id: { in: [tutorA, tutorB] } } });
    await prisma.$disconnect();
  });

  it('tutor B cannot get tutor A\'s student (404, not 401)', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    await expect(service.getForTutorOrFail({ id: stu.id, tutorId: tutorB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.findForTutor({ id: stu.id, tutorId: tutorB })).toBeNull();
  });

  it('tutor B cannot PATCH tutor A\'s student', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    await expect(
      service.update({ id: stu.id, tutorId: tutorB, name: 'hacked' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const after = await prisma.student.findUnique({ where: { id: stu.id } });
    expect(after?.name).toBe('Sara');
  });

  it('tutor B cannot DELETE tutor A\'s student', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    await expect(service.softDelete({ id: stu.id, tutorId: tutorB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const after = await prisma.student.findUnique({ where: { id: stu.id } });
    expect(after?.deletedAt).toBeNull();
  });

  it('tutor B cannot rotate tutor A\'s share token', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    const original = stu.shareToken;
    await expect(service.rotateToken({ id: stu.id, tutorId: tutorB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const after = await prisma.student.findUnique({ where: { id: stu.id } });
    expect(after?.shareToken).toBe(original);
  });

  it('tutor B cannot restore tutor A\'s soft-deleted student', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    await service.softDelete({ id: stu.id, tutorId: tutorA });
    await expect(service.restore({ id: stu.id, tutorId: tutorB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const after = await prisma.student.findUnique({ where: { id: stu.id } });
    expect(after?.deletedAt).not.toBeNull();
  });

  it('tutor B\'s list query never returns tutor A\'s student', async () => {
    if (!dbReady) return;
    await service.create({ tutorId: tutorA, name: 'Sara-A' });
    const { items } = await service.list({ tutorId: tutorB, page: 1, limit: 100, locale: 'en' });
    expect(items.find((s) => s.name === 'Sara-A')).toBeUndefined();
  });

  it('public share-token lookup is intentionally NOT scoped to a tutor (the token IS the auth)', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    const got = await service.findByShareToken(stu.shareToken);
    expect(got?.id).toBe(stu.id);
  });

  it('public share-token lookup returns null for a soft-deleted student', async () => {
    if (!dbReady) return;
    const stu = await service.create({ tutorId: tutorA, name: 'Sara' });
    await service.softDelete({ id: stu.id, tutorId: tutorA });
    expect(await service.findByShareToken(stu.shareToken)).toBeNull();
  });
});
