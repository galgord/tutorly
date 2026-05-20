import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_LEVEL } from './level-policy';

/**
 * Phase 12 per-(student, game) cross-play state. The single point of contact
 * with the StudentGameProgress table so AttemptService stays thin and tests can
 * stub the surface. All writes happen on the finishedAt:null→now transition in
 * AttemptService.finishAttempt — never from the abandoned-attempt cron.
 */
export interface ProgressState {
  level: number;
  seen: string[];
  nudgeCounter: number;
}

@Injectable()
export class StudentGameProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read the cross-play state, defaulting to level 1 / nothing-seen when the
   *  student has never finished a play of this game. */
  async loadState(studentId: string, gameId: string): Promise<ProgressState> {
    const row = await this.prisma.studentGameProgress.findUnique({
      where: { studentId_gameId: { studentId, gameId } },
      select: { currentLevel: true, seenQuestionIds: true, nudgeCounter: true },
    });
    if (!row) return { level: MIN_LEVEL, seen: [], nudgeCounter: 0 };
    return {
      level: row.currentLevel,
      seen: row.seenQuestionIds,
      nudgeCounter: row.nudgeCounter,
    };
  }

  /**
   * Persist a finished play's outcome. Uses Prisma atomic ops (`increment`,
   * array `push`) so concurrent finishes of the same pair don't lose plays or
   * seen ids. `seenQuestionIds` may accrue duplicates across plays — the
   * selector treats it as a Set, so that's harmless.
   */
  async applyFinish(opts: {
    studentId: string;
    gameId: string;
    newLevel: number;
    nudgeCounter: number;
    lastLevelDelta: number;
    lastAccuracy: number | null;
    newlyAnsweredIds: string[];
    now?: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const db = opts.tx ?? this.prisma;
    const now = opts.now ?? new Date();
    const seenInit = Array.from(new Set(opts.newlyAnsweredIds));
    await db.studentGameProgress.upsert({
      where: { studentId_gameId: { studentId: opts.studentId, gameId: opts.gameId } },
      create: {
        studentId: opts.studentId,
        gameId: opts.gameId,
        currentLevel: opts.newLevel,
        nudgeCounter: opts.nudgeCounter,
        playsCompleted: 1,
        seenQuestionIds: seenInit,
        lastAccuracy: opts.lastAccuracy,
        lastLevelDelta: opts.lastLevelDelta,
        lastPlayedAt: now,
      },
      update: {
        currentLevel: opts.newLevel,
        nudgeCounter: opts.nudgeCounter,
        playsCompleted: { increment: 1 },
        seenQuestionIds: { push: opts.newlyAnsweredIds },
        lastAccuracy: opts.lastAccuracy,
        lastLevelDelta: opts.lastLevelDelta,
        lastPlayedAt: now,
      },
    });
  }
}
