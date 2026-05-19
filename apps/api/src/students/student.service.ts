import { Injectable, NotFoundException } from '@nestjs/common';
import { GameStatus, type Prisma, type Student } from '@prisma/client';
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

export interface StudentSummary {
  totalAttempts: number;
  lastAttemptAt: Date | null;
  overallAccuracy: number | null;
  assignedGamesCount: number;
}

export type StudentWithSummary = Student & { summary: StudentSummary };

interface ListResult {
  items: StudentWithSummary[];
  total: number;
}

const EMPTY_SUMMARY: StudentSummary = {
  totalAttempts: 0,
  lastAttemptAt: null,
  overallAccuracy: null,
  assignedGamesCount: 0,
};

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

  async create(opts: {
    tutorId: string;
    name: string;
    notes?: string | null;
    nativeLanguage?: string | null;
  }): Promise<Student> {
    return this.prisma.student.create({
      data: {
        tutorId: opts.tutorId,
        name: opts.name,
        notes: normalizeNotes(opts.notes),
        nativeLanguage: opts.nativeLanguage ?? null,
        // 256-bit share token — long, URL-safe, unique by schema constraint.
        shareToken: generateToken(),
        shareTokenRotatedAt: new Date(),
      },
    });
  }

  async update(opts: {
    id: string;
    tutorId: string;
    name?: string;
    notes?: string | null;
    nativeLanguage?: string | null;
  }): Promise<Student> {
    // Ensure the student exists AND belongs to this tutor before issuing the
    // update. Prisma's updateMany would silently no-op on a cross-tenant id
    // instead of 404-ing, so we read first.
    await this.getForTutorOrFail({ id: opts.id, tutorId: opts.tutorId });

    return this.prisma.student.update({
      where: { id: opts.id },
      data: {
        name: opts.name ?? undefined,
        notes: opts.notes === undefined ? undefined : normalizeNotes(opts.notes),
        nativeLanguage: opts.nativeLanguage === undefined ? undefined : opts.nativeLanguage,
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

    const summaries = await this.summariesByStudentId(items.map((s) => s.id));
    return {
      items: items.map((s) => ({ ...s, summary: summaries.get(s.id) ?? EMPTY_SUMMARY })),
      total,
    };
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

    // Trash items keep an empty summary — historical aggregates aren't useful
    // here and we don't want to surface activity on deleted students.
    return {
      items: items.map((s) => ({ ...s, summary: EMPTY_SUMMARY })),
      total,
    };
  }

  /**
   * Per-student aggregates over completed attempts + assigned games. Pulled in
   * one round-trip after the page is loaded so the list scales O(page-size)
   * not O(total-students). Returns a map keyed by student id; students missing
   * from the map should fall back to EMPTY_SUMMARY at the caller.
   */
  private async summariesByStudentId(studentIds: string[]): Promise<Map<string, StudentSummary>> {
    const out = new Map<string, StudentSummary>();
    if (studentIds.length === 0) return out;

    const [attempts, assignedGames] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { studentId: { in: studentIds }, finishedAt: { not: null } },
        select: { studentId: true, score: true, questionResults: true, finishedAt: true },
      }),
      this.prisma.game.findMany({
        where: {
          status: GameStatus.ASSIGNED,
          deletedAt: null,
          lesson: { studentId: { in: studentIds }, deletedAt: null },
        },
        select: { lesson: { select: { studentId: true } } },
      }),
    ]);

    type Bucket = { total: number; correct: number; answered: number; last: Date | null };
    const buckets = new Map<string, Bucket>();
    const bucket = (id: string): Bucket => {
      let b = buckets.get(id);
      if (!b) {
        b = { total: 0, correct: 0, answered: 0, last: null };
        buckets.set(id, b);
      }
      return b;
    };

    for (const a of attempts) {
      const b = bucket(a.studentId);
      b.total += 1;
      b.correct += a.score;
      b.answered += countAnswered(a.questionResults);
      if (a.finishedAt && (b.last === null || a.finishedAt > b.last)) b.last = a.finishedAt;
    }

    const gamesByStudent = new Map<string, number>();
    for (const g of assignedGames) {
      const sid = g.lesson.studentId;
      gamesByStudent.set(sid, (gamesByStudent.get(sid) ?? 0) + 1);
    }

    for (const id of studentIds) {
      const b = buckets.get(id);
      out.set(id, {
        totalAttempts: b?.total ?? 0,
        lastAttemptAt: b?.last ?? null,
        overallAccuracy: b && b.answered > 0 ? b.correct / b.answered : null,
        assignedGamesCount: gamesByStudent.get(id) ?? 0,
      });
    }
    return out;
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

/**
 * Pull the length of the persisted question-results array out of the JSON
 * column. The Attempt.questionResults shape is `{ results: [{correct, ...}] }`
 * (matching `progress.aggregations.ts`); older rows can legally hold `[]`.
 * Returning 0 for malformed shapes keeps the list endpoint robust.
 */
function countAnswered(raw: unknown): number {
  if (raw == null) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'object' && 'results' in raw) {
    const r = (raw as { results: unknown }).results;
    return Array.isArray(r) ? r.length : 0;
  }
  return 0;
}
