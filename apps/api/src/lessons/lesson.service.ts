import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type Lesson,
  type LessonSource,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SOFT_DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

interface ListLessonsForStudentArgs {
  studentId: string;
  tutorId: string;
  page: number;
  limit: number;
}

export interface LessonWithStudent extends Lesson {
  student: { id: string; name: string; tutorId: string };
}

/**
 * Core lessons data access. Mirrors StudentService's tenant-scoping pattern:
 * every loader funnels through `getLessonForTutorOrFail` so a tutor can
 * never read or mutate a lesson belonging to another tutor's student.
 */
@Injectable()
export class LessonService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single-lesson loader. The lesson is loaded together with its student so
   * the caller can read `student.tutorId` without a second round-trip. We
   * assert ownership here in code rather than via a Prisma `where` that
   * silently 404s — explicit is safer.
   */
  async findLessonForTutor(opts: {
    id: string;
    tutorId: string;
    includeDeleted?: boolean;
  }): Promise<LessonWithStudent | null> {
    const where: Prisma.LessonWhereInput = { id: opts.id };
    if (!opts.includeDeleted) where.deletedAt = null;
    const lesson = await this.prisma.lesson.findFirst({
      where,
      include: { student: { select: { id: true, name: true, tutorId: true } } },
    });
    if (!lesson) return null;
    if (lesson.student.tutorId !== opts.tutorId) return null;
    return lesson;
  }

  async getLessonForTutorOrFail(opts: {
    id: string;
    tutorId: string;
    includeDeleted?: boolean;
  }): Promise<LessonWithStudent> {
    const found = await this.findLessonForTutor(opts);
    if (!found) throw new NotFoundException('Lesson not found.');
    return found;
  }

  /**
   * Verify the student belongs to the tutor before any operation that
   * accepts a studentId from the request. Throws 404 (never 401) on
   * cross-tenant.
   */
  private async assertStudentOwned(opts: { studentId: string; tutorId: string }): Promise<void> {
    const student = await this.prisma.student.findFirst({
      where: { id: opts.studentId, tutorId: opts.tutorId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found.');
  }

  /**
   * Create a lesson. Idempotent on `(studentId, googleEventId)` when
   * `googleEventId` is supplied — calling with the same pair returns the
   * existing row instead of creating a duplicate. This lets the calendar
   * "Add feedback" flow be safely re-clicked.
   */
  async createLesson(opts: {
    studentId: string;
    tutorId: string;
    occurredAt: Date;
    title?: string | null;
    googleEventId?: string | null;
    source: LessonSource;
  }): Promise<Lesson> {
    await this.assertStudentOwned({ studentId: opts.studentId, tutorId: opts.tutorId });

    if (opts.googleEventId) {
      const existing = await this.prisma.lesson.findFirst({
        where: {
          studentId: opts.studentId,
          googleEventId: opts.googleEventId,
          deletedAt: null,
        },
      });
      if (existing) return existing;
    }
    return this.prisma.lesson.create({
      data: {
        studentId: opts.studentId,
        occurredAt: opts.occurredAt,
        title: opts.title ?? null,
        googleEventId: opts.googleEventId ?? null,
        source: opts.source,
      },
    });
  }

  async listForStudent(opts: ListLessonsForStudentArgs): Promise<{ items: Lesson[]; total: number }> {
    await this.assertStudentOwned({ studentId: opts.studentId, tutorId: opts.tutorId });
    const where: Prisma.LessonWhereInput = {
      studentId: opts.studentId,
      deletedAt: null,
    };
    const skip = (opts.page - 1) * opts.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lesson.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: opts.limit,
      }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items, total };
  }

  async softDelete(opts: { id: string; tutorId: string }): Promise<Lesson> {
    await this.getLessonForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    return this.prisma.lesson.update({
      where: { id: opts.id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(opts: { id: string; tutorId: string }): Promise<Lesson> {
    const existing = await this.getLessonForTutorOrFail({
      id: opts.id,
      tutorId: opts.tutorId,
      includeDeleted: true,
    });
    if (!existing.deletedAt) return existing;
    if (existing.deletedAt.getTime() < Date.now() - SOFT_DELETE_GRACE_MS) {
      throw new NotFoundException('Lesson is past the restore grace period.');
    }
    return this.prisma.lesson.update({
      where: { id: opts.id },
      data: { deletedAt: null },
    });
  }

  /** Local lessons in the tutor's universe that fall in [from, to], scoped via student. */
  async listLocalLessonsInRange(opts: {
    tutorId: string;
    from: Date;
    to: Date;
  }): Promise<LessonWithStudent[]> {
    return this.prisma.lesson.findMany({
      where: {
        deletedAt: null,
        occurredAt: { gte: opts.from, lte: opts.to },
        student: { tutorId: opts.tutorId, deletedAt: null },
      },
      include: { student: { select: { id: true, name: true, tutorId: true } } },
      orderBy: { occurredAt: 'asc' },
    });
  }
}
