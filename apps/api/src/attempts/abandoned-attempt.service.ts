import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttemptService } from './attempt.service';

/**
 * Hourly sweep: any Attempt with `finishedAt = null AND startedAt <
 * now() - ATTEMPT_ABANDON_AFTER_HOURS` gets force-finished with the
 * score it had at the time. Mirrors the StudentPurgeService cron
 * shape — quiet, audit-logged, no PII in metadata.
 */
@Injectable()
export class AbandonedAttemptService {
  private readonly logger = new Logger(AbandonedAttemptService.name);

  constructor(
    private readonly attempts: AttemptService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      const count = await this.attempts.finishAbandoned();
      if (count > 0) {
        this.logger.log(`force-finished ${count} abandoned attempt(s)`);
        await this.audit.record({
          tutorId: null,
          actorType: ActorType.SYSTEM,
          action: 'system.attempt.abandoned',
          entityType: 'Attempt',
          metadata: { count },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`abandoned-attempt sweep failed: ${message}`);
    }
  }
}
