import { Injectable, Logger } from '@nestjs/common';
import { ActorType, GameStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { GameGenerationQueue } from './game-generation.queue';

/**
 * Phase 12E automatic background bank top-up. Evaluated fire-and-forget after a
 * play finishes: if an ASSIGNED game's pool is below its target size, hasn't
 * been topped up recently, and the tutor is under their separate top-up budget,
 * enqueue a background generation that APPENDS new (de-duplicated) questions —
 * keeping heavy players supplied with fresh, non-repeating content.
 *
 * Debounce is an atomic `topUpInFlight` claim so concurrent triggers fire at
 * most one top-up per game.
 */
@Injectable()
export class BankTopupService {
  private readonly logger = new Logger(BankTopupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly queue: GameGenerationQueue,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Best-effort: never throws into the caller (the play finish must not fail). */
  async maybeTopUp(gameId: string): Promise<void> {
    try {
      await this.evaluate(gameId);
    } catch (err) {
      this.logger.warn(`maybeTopUp(${gameId}) skipped: ${(err as Error).message}`);
    }
  }

  private async evaluate(gameId: string): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        status: true,
        questionPool: true,
        poolTargetSize: true,
        lastTopUpAt: true,
        topUpInFlight: true,
        lesson: { select: { student: { select: { tutorId: true } } } },
      },
    });
    if (!game || game.status !== GameStatus.ASSIGNED || game.topUpInFlight) return;

    const poolLen = Array.isArray(game.questionPool) ? game.questionPool.length : 0;
    if (poolLen >= game.poolTargetSize) return; // bank already full

    const cooldownMs = this.config.get('TOPUP_COOLDOWN_MS');
    if (game.lastTopUpAt && Date.now() - game.lastTopUpAt.getTime() < cooldownMs) return;

    const tutorId = game.lesson?.student.tutorId;
    if (!tutorId) return;

    // Atomically claim the in-flight flag so concurrent triggers don't pile up.
    const claim = await this.prisma.game.updateMany({
      where: { id: gameId, topUpInFlight: false },
      data: { topUpInFlight: true },
    });
    if (claim.count === 0) return; // another trigger already claimed it

    const reservation = await this.quota.reserveTopUp(tutorId);
    if (!reservation.ok) {
      // Over budget — release the claim and skip silently (audited by quota).
      await this.prisma.game.update({ where: { id: gameId }, data: { topUpInFlight: false } });
      return;
    }

    const enq = this.queue.enqueueTopUp(gameId, { tutorId });
    if (!enq.accepted) return; // breaker open — enqueueTopUp already refunded + cleared

    await this.audit.record({
      tutorId,
      actorType: ActorType.SYSTEM,
      action: 'game.topup.enqueued',
      entityType: 'Game',
      entityId: gameId,
      metadata: { poolLen, target: game.poolTargetSize },
    });
  }
}
