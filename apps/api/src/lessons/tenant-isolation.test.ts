import { NotFoundException } from '@nestjs/common';
import { LessonSource } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LessonService } from './lesson.service';

/**
 * Live-Postgres smoke for the lessons tenant-isolation contract. Tutor B
 * must never see/load/mutate tutor A's lesson by id — the failure mode is
 * always NotFoundException. The calendar merge endpoint also must only
 * return lessons owned by the requesting tutor.
 *
 * Skips automatically if DATABASE_URL is unreachable so unit-only runs pass.
 */
describe('Lesson tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  let lessons: LessonService;
  let tutorA = '';
  let tutorB = '';
  let studentA = '';
  let studentB = '';
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    lessons = new LessonService(prisma);
  });

  beforeEach(async () => {
    if (!dbReady) return;
    const a = await prisma.tutor.create({
      data: { email: `lesson-iso-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const b = await prisma.tutor.create({
      data: { email: `lesson-iso-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const sa = await prisma.student.create({
      data: { tutorId: a.id, name: 'Sara-A', shareToken: `t-${Math.random().toString(36).slice(2, 12)}` },
    });
    const sb = await prisma.student.create({
      data: { tutorId: b.id, name: 'Sara-B', shareToken: `t-${Math.random().toString(36).slice(2, 12)}` },
    });
    tutorA = a.id;
    tutorB = b.id;
    studentA = sa.id;
    studentB = sb.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.tutor.deleteMany({ where: { id: { in: [tutorA, tutorB] } } });
    await prisma.$disconnect();
  });

  it("tutor B cannot get tutor A's lesson (404, not 401)", async () => {
    if (!dbReady) return;
    const les = await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await expect(
      lessons.getLessonForTutorOrFail({ id: les.id, tutorId: tutorB }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await lessons.findLessonForTutor({ id: les.id, tutorId: tutorB })).toBeNull();
  });

  it("tutor B cannot DELETE tutor A's lesson", async () => {
    if (!dbReady) return;
    const les = await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await expect(lessons.softDelete({ id: les.id, tutorId: tutorB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const after = await prisma.lesson.findUnique({ where: { id: les.id } });
    expect(after?.deletedAt).toBeNull();
  });

  it("tutor B cannot RESTORE tutor A's lesson", async () => {
    if (!dbReady) return;
    const les = await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await lessons.softDelete({ id: les.id, tutorId: tutorA });
    await expect(lessons.restore({ id: les.id, tutorId: tutorB })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const after = await prisma.lesson.findUnique({ where: { id: les.id } });
    expect(after?.deletedAt).not.toBeNull();
  });

  it("tutor B cannot create a lesson against tutor A's student", async () => {
    if (!dbReady) return;
    await expect(
      lessons.createLesson({
        studentId: studentA, // belongs to tutor A
        tutorId: tutorB,
        occurredAt: new Date(),
        source: LessonSource.MANUAL,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("tutor B's listForStudent does not return tutor A's lessons", async () => {
    if (!dbReady) return;
    await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      source: LessonSource.MANUAL,
    });
    await expect(
      lessons.listForStudent({ studentId: studentA, tutorId: tutorB, page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("calendar merge only returns the requesting tutor's lessons", async () => {
    if (!dbReady) return;
    const now = new Date();
    await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: now,
      source: LessonSource.MANUAL,
      title: 'A-only',
    });
    await lessons.createLesson({
      studentId: studentB,
      tutorId: tutorB,
      occurredAt: now,
      source: LessonSource.MANUAL,
      title: 'B-only',
    });

    const aRange = await lessons.listLocalLessonsInRange({
      tutorId: tutorA,
      from: new Date(now.getTime() - 86_400_000),
      to: new Date(now.getTime() + 86_400_000),
    });
    expect(aRange.find((l) => l.title === 'A-only')).toBeTruthy();
    expect(aRange.find((l) => l.title === 'B-only')).toBeUndefined();

    const bRange = await lessons.listLocalLessonsInRange({
      tutorId: tutorB,
      from: new Date(now.getTime() - 86_400_000),
      to: new Date(now.getTime() + 86_400_000),
    });
    expect(bRange.find((l) => l.title === 'B-only')).toBeTruthy();
    expect(bRange.find((l) => l.title === 'A-only')).toBeUndefined();
  });

  it('createLesson is idempotent on (studentId, googleEventId) for the owner', async () => {
    if (!dbReady) return;
    const a1 = await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      googleEventId: 'gevt-iso-1',
      source: LessonSource.GOOGLE_CALENDAR,
    });
    const a2 = await lessons.createLesson({
      studentId: studentA,
      tutorId: tutorA,
      occurredAt: new Date(),
      googleEventId: 'gevt-iso-1',
      source: LessonSource.GOOGLE_CALENDAR,
    });
    expect(a2.id).toBe(a1.id);
  });
});
