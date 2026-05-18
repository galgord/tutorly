import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ReserveResult {
  /** True = a slot was reserved; the caller can proceed. */
  ok: boolean;
  /** Current usage AFTER the (attempted) increment. */
  used: number;
  /** Configured cap. */
  cap: number;
  /** When this counter rolls over. */
  resetsAt: Date;
}

export interface UsageSnapshot {
  generationsUsed: number;
  generationsCap: number;
  generationsResetsAt: Date;
  whisperMinutesUsed: number;
  whisperMinutesCap: number;
  whisperMinutesResetsAt: Date;
}

/**
 * Phase 9 per-tutor cost cap. Two independent counters:
 *   - monthlyGenerations (Claude game-gens, cap = GAME_GEN_MONTHLY_CAP)
 *   - monthlyWhisperMinutes (Phase 5 transcription, cap = WHISPER_MONTHLY_MINUTES_CAP)
 *
 * `reserveGeneration` is atomic — it uses an UPDATE ... WHERE
 * monthlyGenerations < cap pattern so concurrent enqueues from the same
 * tutor cannot blow past the cap (the race is contained in Postgres).
 *
 * `refundGeneration` exists for the terminal-FAILED path — if a job
 * exhausts retries we give the tutor their slot back. Failures we caused
 * (LLM outage) shouldn't count against the tutor's cap.
 *
 * Monthly cron resets both counters on the 1st at 00:00 UTC.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // ---- Game generation -----------------------------------------------

  async reserveGeneration(tutorId: string): Promise<ReserveResult> {
    const cap = this.config.get('GAME_GEN_MONTHLY_CAP');

    // Atomic check + increment: only consume the slot if we're under cap.
    // `updateMany` returns the affected row count without throwing on 0
    // matches (a plain `update` would throw P2025).
    const result = await this.prisma.tutor.updateMany({
      where: { id: tutorId, monthlyGenerations: { lt: cap } },
      data: { monthlyGenerations: { increment: 1 } },
    });

    const after = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyGenerations: true, monthlyGenerationsResetAt: true },
    });
    if (!after) {
      // Defensive — caller's tutorId came from the session so this
      // shouldn't happen, but don't crash.
      return { ok: false, used: cap, cap, resetsAt: new Date() };
    }

    if (result.count === 0) {
      // Over cap — audit so the operator can see when caps bite.
      await this.audit.record({
        tutorId,
        actorType: ActorType.SYSTEM,
        action: 'quota.generation.exceeded',
        entityType: 'Tutor',
        entityId: tutorId,
        metadata: { cap, used: after.monthlyGenerations },
      });
      return {
        ok: false,
        used: after.monthlyGenerations,
        cap,
        resetsAt: nextResetDate(after.monthlyGenerationsResetAt),
      };
    }
    return {
      ok: true,
      used: after.monthlyGenerations,
      cap,
      resetsAt: nextResetDate(after.monthlyGenerationsResetAt),
    };
  }

  /**
   * Give back a slot consumed by `reserveGeneration` when the underlying
   * generation hits a terminal failure. We don't try to be clever about
   * "was this an LLM failure vs the tutor's fault" — any FAILED job is
   * a refund. Atomic so a concurrent reset doesn't drive the counter
   * negative.
   */
  async refundGeneration(tutorId: string): Promise<void> {
    const result = await this.prisma.tutor.updateMany({
      where: { id: tutorId, monthlyGenerations: { gt: 0 } },
      data: { monthlyGenerations: { decrement: 1 } },
    });
    if (result.count > 0) {
      await this.audit.record({
        tutorId,
        actorType: ActorType.SYSTEM,
        action: 'quota.generation.refunded',
        entityType: 'Tutor',
        entityId: tutorId,
      });
    }
  }

  // ---- Snapshot for /admin/usage + UI banner --------------------------

  async getUsage(tutorId: string): Promise<UsageSnapshot> {
    const t = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      select: {
        monthlyGenerations: true,
        monthlyGenerationsResetAt: true,
        monthlyWhisperMinutes: true,
        monthlyWhisperResetAt: true,
      },
    });
    return {
      generationsUsed: t?.monthlyGenerations ?? 0,
      generationsCap: this.config.get('GAME_GEN_MONTHLY_CAP'),
      generationsResetsAt: nextResetDate(t?.monthlyGenerationsResetAt ?? new Date()),
      whisperMinutesUsed: t?.monthlyWhisperMinutes ?? 0,
      whisperMinutesCap: this.config.get('WHISPER_MONTHLY_MINUTES_CAP'),
      whisperMinutesResetsAt: nextResetDate(t?.monthlyWhisperResetAt ?? new Date()),
    };
  }

  // ---- Aggregate for the admin endpoint -------------------------------

  async getAggregateUsage(): Promise<{
    tutorCount: number;
    activeTutorCount: number;
    totalGenerationsThisMonth: number;
    totalWhisperMinutesThisMonth: number;
    capGenerations: number;
    capWhisperMinutes: number;
  }> {
    const [tutorCount, activeTutorCount, totals] = await this.prisma.$transaction([
      this.prisma.tutor.count(),
      this.prisma.tutor.count({ where: { deletedAt: null } }),
      this.prisma.tutor.aggregate({
        where: { deletedAt: null },
        _sum: { monthlyGenerations: true, monthlyWhisperMinutes: true },
      }),
    ]);
    return {
      tutorCount,
      activeTutorCount,
      totalGenerationsThisMonth: totals._sum.monthlyGenerations ?? 0,
      totalWhisperMinutesThisMonth: totals._sum.monthlyWhisperMinutes ?? 0,
      capGenerations: this.config.get('GAME_GEN_MONTHLY_CAP'),
      capWhisperMinutes: this.config.get('WHISPER_MONTHLY_MINUTES_CAP'),
    };
  }

  // ---- Monthly reset cron --------------------------------------------

  /** First-of-the-month at 00:00 UTC. Resets every tutor's counters. */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async runMonthlyReset(): Promise<void> {
    await this.resetAll();
  }

  /** Test-callable surface. Returns the count of tutors reset. */
  async resetAll(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.tutor.updateMany({
      where: {},
      data: {
        monthlyGenerations: 0,
        monthlyGenerationsResetAt: now,
        monthlyWhisperMinutes: 0,
        monthlyWhisperResetAt: now,
      },
    });
    this.logger.log(`monthly quota reset: ${result.count} tutor(s)`);
    await this.audit.record({
      tutorId: null,
      actorType: ActorType.SYSTEM,
      action: 'quota.monthly.reset',
      metadata: { count: result.count },
    });
    return result.count;
  }
}

/**
 * The counter resets on the 1st of the next calendar month at 00:00 UTC.
 * We don't actually compute the *exact* cron time — Phase 9 just needs
 * a stable "when does it reset" date for the UI banner.
 */
export function nextResetDate(lastReset: Date): Date {
  const d = new Date(lastReset);
  // Move to the first of the next month, 00:00 UTC.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
