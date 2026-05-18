import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Student } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateToken } from '../auth/token.util';

// 30-day grace window for soft-deleted students before the hard-delete cron
// purges them.
export const SOFT_DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

interface ListOptions {
  tutorId: string;
  q?: string | null;
  page: number;
  limit: number;
}

interface ListResult {
  items: Student[];
  total: number;
}

/**
 * Core student data access. Every method that loads a single student funnels
 * through `findForTutor` so we cannot accidentally cross tenant boundaries —
 * a tutor never sees, mutates, or deletes a student that isn't theirs.
 *
 * `tutorId` is always derived from the session at the controller layer; it is
 * never accepted from the request body or query string.
 */
@Injectable()
export class StudentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant-scoped single-student loader. Returns null when missing or owned by another tutor. */
  async findForTutor(opts: { id: string; tutorId: string; includeDeleted?: boolean }): Promise<Student | null> {
    const where: Prisma.StudentWhereInput = { id: opts.id, tutorId: opts.tutorId };
    if (!opts.includeDeleted) where.deletedAt = null;
    return this.prisma.student.findFirst({ where });
  }

  /** Like `findForTutor` but throws a 404 (never 401) on cross-tenant or missing. */
  async getForTutorOrFail(opts: { id: string; tutorId: string; includeDeleted?: boolean }): Promise<Student> {
    const student = await this.findForTutor(opts);
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  async create(opts: { tutorId: string; name: string; notes?: string | null }): Promise<Student> {
    return this.prisma.student.create({
      data: {
        tutorId: opts.tutorId,
        name: opts.name,
        notes: normalizeNotes(opts.notes),
        // 256-bit share token — long, URL-safe, unique by schema constraint.
        shareToken: generateToken(),
        shareTokenRotatedAt: new Date(),
      },
    });
  }

  async update(opts: { id: string; tutorId: string; name?: string; notes?: string | null }): Promise<Student> {
    // Ensure the student exists AND belongs to this tutor before issuing the
    // update. Prisma's updateMany would silently no-op on a cross-tenant id
    // instead of 404-ing, so we read first.
    await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });

    return this.prisma.student.update({
      where: { id: opts.id },
      data: {
        name: opts.name ?? undefined,
        notes: opts.notes === undefined ? undefined : normalizeNotes(opts.notes),
      },
    });
  }

  async softDelete(opts: { id: string; tutorId: string }): Promise<Student> {
    await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    return this.prisma.student.update({
      where: { id: opts.id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(opts: { id: string; tutorId: string }): Promise<Student> {
    const existing = await this.getForTutorOrFail({
      id: opts.id,
      tutorId: opts.tutorId,
      includeDeleted: true,
    });
    if (!existing.deletedAt) return existing; // already live, no-op

    // Refuse to restore students past the 30-day grace window. The cron will
    // hard-delete them on its next run anyway, but be explicit here.
    if (existing.deletedAt.getTime() < Date.now() - SOFT_DELETE_GRACE_MS) {
      throw new NotFoundException('Student is past the restore grace period.');
    }

    return this.prisma.student.update({
      where: { id: opts.id },
      data: { deletedAt: null },
    });
  }

  async rotateToken(opts: { id: string; tutorId: string }): Promise<Student> {
    await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });
    return this.prisma.student.update({
      where: { id: opts.id },
      data: {
        shareToken: generateToken(),
        shareTokenRotatedAt: new Date(),
      },
    });
  }

  /**
   * Paginated list of a tutor's live students. Optional case-insensitive name
   * search is delegated to Postgres `ILIKE`; we then re-sort the page in
   * memory via `Intl.Collator` so locale-aware ordering (Hebrew, Portuguese
   * accents) is respected. Locale comes from the tutor's preference.
   */
  async list(opts: ListOptions & { locale: string }): Promise<ListResult> {
    const skip = (opts.page - 1) * opts.limit;
    const where: Prisma.StudentWhereInput = {
      tutorId: opts.tutorId,
      deletedAt: null,
    };
    if (opts.q && opts.q.length > 0) {
      where.name = { contains: opts.q, mode: 'insensitive' };
    }

    const [items, total] = await this.prisma.$transaction([
      // Pull a generous slice ordered by createdAt (deterministic for tests),
      // then re-sort by locale-aware name. Pagination is applied at the DB.
      this.prisma.student.findMany({
        where,
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: opts.limit,
      }),
      this.prisma.student.count({ where }),
    ]);

    const collator = new Intl.Collator(opts.locale, { sensitivity: 'base', numeric: true });
    items.sort((a, b) => collator.compare(a.name, b.name));

    return { items, total };
  }

  /** Paginated trash view — soft-deleted students still within grace. */
  async listTrash(opts: ListOptions & { locale: string }): Promise<ListResult> {
    const skip = (opts.page - 1) * opts.limit;
    const cutoff = new Date(Date.now() - SOFT_DELETE_GRACE_MS);
    const where: Prisma.StudentWhereInput = {
      tutorId: opts.tutorId,
      deletedAt: { not: null, gte: cutoff },
    };
    if (opts.q && opts.q.length > 0) {
      where.name = { contains: opts.q, mode: 'insensitive' };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        orderBy: [{ deletedAt: 'desc' }, { name: 'asc' }],
        skip,
        take: opts.limit,
      }),
      this.prisma.student.count({ where }),
    ]);

    const collator = new Intl.Collator(opts.locale, { sensitivity: 'base', numeric: true });
    items.sort((a, b) => collator.compare(a.name, b.name));

    return { items, total };
  }

  /**
   * Public lookup by share token. No tutor scoping — the token itself is the
   * authorization. Returns null if the token doesn't exist or the student is
   * soft-deleted (the public endpoint translates this to 404).
   */
  async findByShareToken(token: string): Promise<Student | null> {
    if (!token || token.length === 0) return null;
    return this.prisma.student.findFirst({
      where: { shareToken: token, deletedAt: null },
    });
  }

  /** Hard-deletes all students whose grace window has elapsed. Returns the count. */
  async hardDeleteExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - SOFT_DELETE_GRACE_MS);
    const result = await this.prisma.student.deleteMany({
      where: { deletedAt: { lt: cutoff } },
    });
    return result.count;
  }
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes === undefined || notes === null) return null;
  const trimmed = notes.trim();
  return trimmed.length === 0 ? null : trimmed;
}
