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
  topUpGenerationsUsed: number;
  topUpGenerationsCap: number;
  topUpGenerationsResetsAt: Date;
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

  // ---- Whisper transcription (Phase 5) --------------------------------

  /**
   * Atomic minute reservation for a Whisper job. Mirrors the
   * `reserveGeneration` shape: an `UPDATE ... WHERE
   * monthlyWhisperMinutes + N <= cap` predicate so concurrent uploads
   * from the same tutor cannot blow past the cap.
   *
   * The `minutes` arg is the ceil() of the uploaded audio's duration in
   * minutes (passed by the controller after the client-reported value
   * is sanity-checked). Refunded if Whisper hits terminal failure.
   *
   * Implementation detail: Prisma doesn't expose arithmetic in the
   * `where` clause, so we emit raw SQL for the check. The refund path
   * uses Prisma's `updateMany` because the clamp is a simple `>= N`.
   */
  async reserveWhisperMinutes(
    tutorId: string,
    minutes: number,
  ): Promise<ReserveResult> {
    const cap = this.config.get('WHISPER_MONTHLY_MINUTES_CAP');
    if (!Number.isInteger(minutes) || minutes <= 0) {
      // Defense in depth — controller should have rejected non-positive
      // values, but the quota layer enforces invariants too.
      throw new Error('reserveWhisperMinutes: minutes must be a positive integer.');
    }

    // Atomic check + increment via raw SQL: Postgres serializes the
    // UPDATE so 20 concurrent reserves against the same tutor can never
    // collectively exceed the cap.
    const rows = await this.prisma.$executeRaw`
      UPDATE "Tutor"
         SET "monthlyWhisperMinutes" = "monthlyWhisperMinutes" + ${minutes}
       WHERE id = ${tutorId}
         AND "monthlyWhisperMinutes" + ${minutes} <= ${cap}
    `;

    const after = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyWhisperMinutes: true, monthlyWhisperResetAt: true },
    });
    if (!after) {
      return { ok: false, used: cap, cap, resetsAt: new Date() };
    }

    if (rows === 0) {
      await this.audit.record({
        tutorId,
        actorType: ActorType.SYSTEM,
        action: 'quota.whisper.exceeded',
        entityType: 'Tutor',
        entityId: tutorId,
        metadata: { cap, used: after.monthlyWhisperMinutes, requested: minutes },
      });
      return {
        ok: false,
        used: after.monthlyWhisperMinutes,
        cap,
        resetsAt: nextResetDate(after.monthlyWhisperResetAt),
      };
    }
    return {
      ok: true,
      used: after.monthlyWhisperMinutes,
      cap,
      resetsAt: nextResetDate(after.monthlyWhisperResetAt),
    };
  }

  /**
   * Give back Whisper minutes consumed by `reserveWhisperMinutes` when
   * the underlying job hits a terminal failure (provider outage, schema
   * mismatch, etc.). Clamps at 0 so a concurrent reset can't drive the
   * counter negative.
   */
  async refundWhisperMinutes(tutorId: string, minutes: number): Promise<void> {
    if (!Number.isInteger(minutes) || minutes <= 0) return;
    const result = await this.prisma.tutor.updateMany({
      where: { id: tutorId, monthlyWhisperMinutes: { gte: minutes } },
      data: { monthlyWhisperMinutes: { decrement: minutes } },
    });
    if (result.count > 0) {
      await this.audit.record({
        tutorId,
        actorType: ActorType.SYSTEM,
        action: 'quota.whisper.refunded',
        entityType: 'Tutor',
        entityId: tutorId,
        metadata: { minutes },
      });
    } else {
      // The tutor doesn't have enough minutes to refund — clamp to 0
      // instead of refusing. Happens if the monthly reset cron ran
      // between reserve and refund.
      await this.prisma.tutor.update({
        where: { id: tutorId },
        data: { monthlyWhisperMinutes: 0 },
      });
    }
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

  // ---- Phase 12E — automatic bank top-up budget -----------------------

  /**
   * Atomic reserve against the SEPARATE top-up budget. Same UPDATE … WHERE
   * monthlyTopUpGenerations < cap idiom as `reserveGeneration` so concurrent
   * top-up triggers can never collectively exceed the cap. Never touches the
   * tutor's manual generation quota.
   */
  async reserveTopUp(tutorId: string): Promise<ReserveResult> {
    const cap = this.config.get('GAME_GEN_TOPUP_MONTHLY_CAP');
    const result = await this.prisma.tutor.updateMany({
      where: { id: tutorId, monthlyTopUpGenerations: { lt: cap } },
      data: { monthlyTopUpGenerations: { increment: 1 } },
    });
    const after = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { monthlyTopUpGenerations: true, monthlyTopUpResetAt: true },
    });
    if (!after) return { ok: false, used: cap, cap, resetsAt: new Date() };
    if (result.count === 0) {
      await this.audit.record({
        tutorId,
        actorType: ActorType.SYSTEM,
        action: 'quota.topup.exceeded',
        entityType: 'Tutor',
        entityId: tutorId,
        metadata: { cap, used: after.monthlyTopUpGenerations },
      });
      return {
        ok: false,
        used: after.monthlyTopUpGenerations,
        cap,
        resetsAt: nextResetDate(after.monthlyTopUpResetAt),
      };
    }
    return {
      ok: true,
      used: after.monthlyTopUpGenerations,
      cap,
      resetsAt: nextResetDate(after.monthlyTopUpResetAt),
    };
  }

  /** Give back a top-up slot consumed by `reserveTopUp` on terminal failure. */
  async refundTopUp(tutorId: string): Promise<void> {
    const result = await this.prisma.tutor.updateMany({
      where: { id: tutorId, monthlyTopUpGenerations: { gt: 0 } },
      data: { monthlyTopUpGenerations: { decrement: 1 } },
    });
    if (result.count > 0) {
      await this.audit.record({
        tutorId,
        actorType: ActorType.SYSTEM,
        action: 'quota.topup.refunded',
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
        monthlyTopUpGenerations: true,
        monthlyTopUpResetAt: true,
      },
    });
    return {
      generationsUsed: t?.monthlyGenerations ?? 0,
      generationsCap: this.config.get('GAME_GEN_MONTHLY_CAP'),
      generationsResetsAt: nextResetDate(t?.monthlyGenerationsResetAt ?? new Date()),
      whisperMinutesUsed: t?.monthlyWhisperMinutes ?? 0,
      whisperMinutesCap: this.config.get('WHISPER_MONTHLY_MINUTES_CAP'),
      whisperMinutesResetsAt: nextResetDate(t?.monthlyWhisperResetAt ?? new Date()),
      topUpGenerationsUsed: t?.monthlyTopUpGenerations ?? 0,
      topUpGenerationsCap: this.config.get('GAME_GEN_TOPUP_MONTHLY_CAP'),
      topUpGenerationsResetsAt: nextResetDate(t?.monthlyTopUpResetAt ?? new Date()),
    };
  }

  // ---- Aggregate for the admin endpoint -------------------------------

  async getAggregateUsage(): Promise<{
    tutorCount: number;
    activeTutorCount: number;
    totalGenerationsThisMonth: number;
    totalWhisperMinutesThisMonth: number;
    totalTopUpGenerationsThisMonth: number;
    capGenerations: number;
    capWhisperMinutes: number;
    capTopUpGenerations: number;
  }> {
    const [tutorCount, activeTutorCount, totals] = await this.prisma.$transaction([
      this.prisma.tutor.count(),
      this.prisma.tutor.count({ where: { deletedAt: null } }),
      this.prisma.tutor.aggregate({
        where: { deletedAt: null },
        _sum: {
          monthlyGenerations: true,
          monthlyWhisperMinutes: true,
          monthlyTopUpGenerations: true,
        },
      }),
    ]);
    return {
      tutorCount,
      activeTutorCount,
      totalGenerationsThisMonth: totals._sum.monthlyGenerations ?? 0,
      totalWhisperMinutesThisMonth: totals._sum.monthlyWhisperMinutes ?? 0,
      totalTopUpGenerationsThisMonth: totals._sum.monthlyTopUpGenerations ?? 0,
      capGenerations: this.config.get('GAME_GEN_MONTHLY_CAP'),
      capWhisperMinutes: this.config.get('WHISPER_MONTHLY_MINUTES_CAP'),
      capTopUpGenerations: this.config.get('GAME_GEN_TOPUP_MONTHLY_CAP'),
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
        monthlyTopUpGenerations: 0,
        monthlyTopUpResetAt: now,
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
