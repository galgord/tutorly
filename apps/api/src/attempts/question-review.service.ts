import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dueDate, nextReview } from './leitner';

/**
 * Phase 12C spaced-repetition store. Owns all QuestionReview table access:
 *  - `dueReviews` — questionIds due now for a (student, game), oldest first.
 *  - `recordResults` — Leitner write-back for a finished play's answers.
 *
 * Wired into AttemptService.finishAttempt's single transaction in Phase 12D;
 * shipped here standalone with its own unit + live-DB tenant tests.
 */
export interface ReviewResultInput {
  questionId: string;
  correct: boolean;
}

@Injectable()
export class QuestionReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Questions whose `dueAt` has passed for this (student, game), oldest first. */
  async dueReviews(opts: {
    studentId: string;
    gameId: string;
    now?: Date;
    limit?: number;
  }): Promise<string[]> {
    const now = opts.now ?? new Date();
    const rows = await this.prisma.questionReview.findMany({
      where: { studentId: opts.studentId, gameId: opts.gameId, dueAt: { lte: now } },
      orderBy: { dueAt: 'asc' },
      ...(opts.limit !== undefined ? { take: opts.limit } : {}),
      select: { questionId: true },
    });
    return rows.map((r) => r.questionId);
  }

  /**
   * Apply the Leitner schedule for each answered question. Reads the existing
   * boxes in one query, then upserts: correct → promote a box (longer interval),
   * wrong → reset to box 1 (due next session). Counters use atomic increments.
   */
  async recordResults(opts: {
    studentId: string;
    gameId: string;
    results: ReviewResultInput[];
    intervals: number[];
    now?: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    if (opts.results.length === 0) return;
    const db = opts.tx ?? this.prisma;
    const now = opts.now ?? new Date();

    const ids = opts.results.map((r) => r.questionId);
    const existing = await db.questionReview.findMany({
      where: { studentId: opts.studentId, questionId: { in: ids } },
      select: { questionId: true, box: true },
    });
    const priorBox = new Map(existing.map((e) => [e.questionId, e.box]));

    for (const r of opts.results) {
      // A brand-new question starts conceptually at box 1.
      const { box, intervalDays } = nextReview({
        box: priorBox.get(r.questionId) ?? 1,
        correct: r.correct,
        intervals: opts.intervals,
      });
      const due = dueDate(now, intervalDays);
      await db.questionReview.upsert({
        where: {
          studentId_questionId: { studentId: opts.studentId, questionId: r.questionId },
        },
        create: {
          studentId: opts.studentId,
          gameId: opts.gameId,
          questionId: r.questionId,
          box,
          dueAt: due,
          lastResult: r.correct,
          timesSeen: 1,
          timesWrong: r.correct ? 0 : 1,
          lastSeenAt: now,
        },
        update: {
          box,
          dueAt: due,
          lastResult: r.correct,
          timesSeen: { increment: 1 },
          ...(r.correct ? {} : { timesWrong: { increment: 1 } }),
          lastSeenAt: now,
        },
      });
    }
  }
}
