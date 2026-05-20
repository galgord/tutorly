import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { GameGenerationQueue } from '../games/game-generation.queue';
import { QuotaService } from './quota.service';

interface AdminUsageResponse {
  tutors: {
    total: number;
    active: number;
  };
  generations: {
    totalThisMonth: number;
    cap: number;
  };
  whisper: {
    totalMinutesThisMonth: number;
    capMinutesPerTutor: number;
  };
  topUp: {
    totalThisMonth: number;
    capPerTutor: number;
  };
  queue: {
    inFlight: number;
    breakerOpen: boolean;
    consecutiveFailures: number;
  };
}

/**
 * Phase 9 ops surface. Static admin-token gating — set `ADMIN_TOKEN` in
 * env (required in production via the env Zod refinement) and pass it as
 * `x-admin-token`. Not session-auth because this is for the operator
 * (or a future bull-board / metrics scraper), not tutors.
 *
 * Cheaper than a full observability stack and good enough for "is the
 * cost spike real?" answers in v1.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly quota: QuotaService,
    private readonly config: ConfigService,
    @Inject(GameGenerationQueue) private readonly queue: GameGenerationQueue,
  ) {}

  @Get('usage')
  async usage(@Headers('x-admin-token') token: string | undefined): Promise<AdminUsageResponse> {
    this.requireAdmin(token);
    const agg = await this.quota.getAggregateUsage();
    const snap = this.queue.snapshot();
    return {
      tutors: { total: agg.tutorCount, active: agg.activeTutorCount },
      generations: {
        totalThisMonth: agg.totalGenerationsThisMonth,
        cap: agg.capGenerations,
      },
      whisper: {
        totalMinutesThisMonth: agg.totalWhisperMinutesThisMonth,
        capMinutesPerTutor: agg.capWhisperMinutes,
      },
      topUp: {
        totalThisMonth: agg.totalTopUpGenerationsThisMonth,
        capPerTutor: agg.capTopUpGenerations,
      },
      queue: {
        inFlight: snap.inFlight,
        breakerOpen: snap.breakerOpen,
        consecutiveFailures: snap.consecutiveFailures,
      },
    };
  }

  private requireAdmin(token: string | undefined): void {
    const expected = this.config.get('ADMIN_TOKEN');
    if (!expected) {
      // No token configured. Refuse unconditionally so a misconfigured
      // prod env doesn't expose the endpoint.
      throw new ForbiddenException('Admin endpoints disabled (no ADMIN_TOKEN set).');
    }
    if (!token || !timingSafeEqual(token, expected)) {
      throw new ForbiddenException();
    }
  }
}

/** Constant-time comparison; avoids leaking token length via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still walk the longer one to keep timing roughly constant. Skip
    // when lengths differ; this is a defensive nicety, not a security
    // primitive (the lengths can be probed elsewhere).
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
