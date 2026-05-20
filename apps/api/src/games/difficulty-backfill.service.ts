import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assignHeuristicDifficulty, isUnratedPool } from './difficulty-heuristic';
import { parsePool } from './games.service';

/**
 * Phase 12 one-shot backfill. On boot, scan existing games and assign
 * heuristic 1–5 difficulties to any pool that is still "unrated" (every
 * question at the default tier — i.e. generated before difficulty tagging
 * existed). Idempotent: already-rated pools are skipped, so repeat boots are
 * cheap. Runs off the play read-path so there's no write-on-read race.
 *
 * Mirrors GameGenerationQueue's stuck-job sweep: guarded so a missing DB
 * (some unit tests) never crashes module init.
 */
@Injectable()
export class DifficultyBackfillService implements OnModuleInit {
  private readonly logger = new Logger(DifficultyBackfillService.name);
  private static readonly BATCH = 200;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const rerated = await this.run();
      if (rerated > 0) {
        this.logger.log(`difficulty backfill: re-rated ${rerated} game pool(s).`);
      }
    } catch (err) {
      this.logger.debug(`difficulty backfill skipped: ${(err as Error).message}`);
    }
  }

  /** Test-callable. Returns the number of pools re-rated. */
  async run(): Promise<number> {
    let cursor: string | undefined;
    let rerated = 0;
    for (;;) {
      const batch = await this.prisma.game.findMany({
        select: { id: true, questionPool: true },
        orderBy: { id: 'asc' },
        take: DifficultyBackfillService.BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      for (const g of batch) {
        const pool = parsePool(g.questionPool);
        if (pool.length === 0 || !isUnratedPool(pool)) continue;
        const rated = assignHeuristicDifficulty(pool);
        await this.prisma.game.update({
          where: { id: g.id },
          data: { questionPool: rated as unknown as Prisma.InputJsonValue },
        });
        rerated += 1;
      }
      if (batch.length < DifficultyBackfillService.BATCH) break;
      cursor = batch[batch.length - 1]!.id;
    }
    return rerated;
  }
}
