import { NotFoundException } from '@nestjs/common';
import { FeedbackSource, LessonSource } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import { LessonService } from './lesson.service';

function fakeLesson(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over.id ?? 'les_1',
    studentId: over.studentId ?? 'stu_1',
    googleEventId: (over.googleEventId as string | null | undefined) ?? null,
    source: (over.source as LessonSource | undefined) ?? LessonSource.MANUAL,
    title: (over.title as string | null | undefined) ?? null,
    occurredAt: (over.occurredAt as Date | undefined) ?? new Date('2026-05-01T10:00:00Z'),
    feedbackText: null,
    feedbackSource: 'TEXT',
    audioUrl: null,
    deletedAt: (over.deletedAt as Date | null | undefined) ?? null,
    createdAt: (over.createdAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: (over.updatedAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
  };
}

function makeService() {
  const prisma = makePrismaMock();
  return { svc: new LessonService(prisma), prisma };
}

describe('LessonService.findLessonForTutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null on missing lesson', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    expect(await svc.findLessonForTutor({ id: 'les_1', tutorId: 'tutor_a' })).toBeNull();
  });

  it('returns null when the lesson belongs to another tutor', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson(),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_b' },
    } as never);
    expect(await svc.findLessonForTutor({ id: 'les_1', tutorId: 'tutor_a' })).toBeNull();
  });

  it('returns the lesson when scoped match', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson(),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    const got = await svc.findLessonForTutor({ id: 'les_1', tutorId: 'tutor_a' });
    expect(got?.id).toBe('les_1');
    expect(got?.student.name).toBe('Sara');
  });

  it('getLessonForTutorOrFail throws NotFound on cross-tenant', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    await expect(
      svc.getLessonForTutorOrFail({ id: 'les_1', tutorId: 'tutor_a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('includeDeleted broadens the where clause', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    await svc.findLessonForTutor({ id: 'les_1', tutorId: 'tutor_a', includeDeleted: true });
    const where = vi.mocked(prisma.lesson.findFirst).mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where).not.toHaveProperty('deletedAt');
  });
});

describe('LessonService.createLesson', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when student doesn\'t belong to the tutor', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null as never);
    await expect(
      svc.createLesson({
        studentId: 'stu_1',
        tutorId: 'tutor_a',
        occurredAt: new Date(),
        source: LessonSource.MANUAL,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a MANUAL lesson when no googleEventId', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: 'stu_1' } as never);
    vi.mocked(prisma.lesson.create).mockResolvedValue(fakeLesson() as never);
    await svc.createLesson({
      studentId: 'stu_1',
      tutorId: 'tutor_a',
      occurredAt: new Date('2026-05-01T10:00:00Z'),
      title: 'first lesson',
      source: LessonSource.MANUAL,
    });
    const args = vi.mocked(prisma.lesson.create).mock.calls[0]?.[0]?.data;
    expect(args?.source).toBe(LessonSource.MANUAL);
    expect(args?.googleEventId).toBeNull();
    expect(args?.title).toBe('first lesson');
  });

  it('is idempotent on (studentId, googleEventId)', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: 'stu_1' } as never);
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(
      fakeLesson({ googleEventId: 'gevt-1' }) as never,
    );
    const out = await svc.createLesson({
      studentId: 'stu_1',
      tutorId: 'tutor_a',
      occurredAt: new Date(),
      googleEventId: 'gevt-1',
      source: LessonSource.GOOGLE_CALENDAR,
    });
    expect(out.id).toBe('les_1');
    expect(prisma.lesson.create).not.toHaveBeenCalled();
  });

  it('creates GOOGLE_CALENDAR lesson when googleEventId is novel', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: 'stu_1' } as never);
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.lesson.create).mockResolvedValue(
      fakeLesson({ googleEventId: 'gevt-1', source: LessonSource.GOOGLE_CALENDAR }) as never,
    );
    await svc.createLesson({
      studentId: 'stu_1',
      tutorId: 'tutor_a',
      occurredAt: new Date(),
      googleEventId: 'gevt-1',
      source: LessonSource.GOOGLE_CALENDAR,
    });
    expect(vi.mocked(prisma.lesson.create).mock.calls[0]?.[0]?.data.googleEventId).toBe('gevt-1');
  });
});

describe('LessonService.listForStudent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses cross-tenant student id', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null as never);
    await expect(
      svc.listForStudent({ studentId: 'stu_1', tutorId: 'tutor_a', page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns paginated items ordered by occurredAt desc', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: 'stu_1' } as never);
    vi.mocked(prisma.lesson.findMany).mockResolvedValue([fakeLesson()] as never);
    vi.mocked(prisma.lesson.count).mockResolvedValue(1 as never);
    const { items, total } = await svc.listForStudent({
      studentId: 'stu_1',
      tutorId: 'tutor_a',
      page: 1,
      limit: 10,
    });
    expect(items).toHaveLength(1);
    expect(total).toBe(1);
    const args = vi.mocked(prisma.lesson.findMany).mock.calls[0]?.[0];
    expect(args?.orderBy).toEqual([{ occurredAt: 'desc' }, { createdAt: 'desc' }]);
  });
});

describe('LessonService.softDelete / restore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('softDelete refuses cross-tenant lesson', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    await expect(svc.softDelete({ id: 'les_1', tutorId: 'tutor_a' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('softDelete sets deletedAt', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson(),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue(fakeLesson() as never);
    await svc.softDelete({ id: 'les_1', tutorId: 'tutor_a' });
    const args = vi.mocked(prisma.lesson.update).mock.calls[0]?.[0]?.data;
    expect(args?.deletedAt).toBeInstanceOf(Date);
  });

  it('restore is a no-op when already live', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson({ deletedAt: null }),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    await svc.restore({ id: 'les_1', tutorId: 'tutor_a' });
    expect(prisma.lesson.update).not.toHaveBeenCalled();
  });

  it('restore refuses past grace window', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    await expect(svc.restore({ id: 'les_1', tutorId: 'tutor_a' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('restore clears deletedAt within grace', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson({ deletedAt: new Date(Date.now() - 5 * 86_400_000) }),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue(fakeLesson() as never);
    await svc.restore({ id: 'les_1', tutorId: 'tutor_a' });
    expect(vi.mocked(prisma.lesson.update).mock.calls[0]?.[0]?.data).toEqual({ deletedAt: null });
  });
});

describe('LessonService.listLocalLessonsInRange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes via the student relation', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findMany).mockResolvedValue([] as never);
    await svc.listLocalLessonsInRange({
      tutorId: 'tutor_a',
      from: new Date(0),
      to: new Date(10),
    });
    const where = vi.mocked(prisma.lesson.findMany).mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect((where.student as Record<string, unknown>).tutorId).toBe('tutor_a');
    expect((where.student as Record<string, unknown>).deletedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });
});

describe('LessonService.updateFeedback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses cross-tenant lesson with NotFound', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null as never);
    await expect(
      svc.updateFeedback({ id: 'les_1', tutorId: 'tutor_a', feedbackText: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.lesson.update).not.toHaveBeenCalled();
  });

  it('persists feedback text and defaults source to TEXT', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson(),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue(fakeLesson() as never);
    await svc.updateFeedback({ id: 'les_1', tutorId: 'tutor_a', feedbackText: 'pay attention to ser/estar' });
    const data = vi.mocked(prisma.lesson.update).mock.calls[0]?.[0]?.data;
    expect(data?.feedbackText).toBe('pay attention to ser/estar');
    expect(data?.feedbackSource).toBe(FeedbackSource.TEXT);
  });

  it('explicit VOICE source flows through', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue({
      ...fakeLesson(),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue(fakeLesson() as never);
    await svc.updateFeedback({
      id: 'les_1',
      tutorId: 'tutor_a',
      feedbackText: 'transcribed text',
      source: FeedbackSource.VOICE,
    });
    const data = vi.mocked(prisma.lesson.update).mock.calls[0]?.[0]?.data;
    expect(data?.feedbackSource).toBe(FeedbackSource.VOICE);
  });
});
