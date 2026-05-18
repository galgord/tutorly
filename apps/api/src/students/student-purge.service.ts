import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { StudentService } from './student.service';

/**
 * Hard-deletes students whose 30-day grace window has elapsed. Runs nightly
 * (slightly past midnight UTC to avoid colliding with other midnight jobs).
 *
 * The audit log entry is `system.student.purged` with a count, never with
 * the individual student ids (those records are gone).
 */
@Injectable()
export class StudentPurgeService {
  private readonly logger = new Logger(StudentPurgeService.name);

  constructor(
    private readonly students: StudentService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<void> {
    try {
      const count = await this.students.hardDeleteExpired();
      if (count > 0) {
        this.logger.log(`hard-deleted ${count} student(s) past grace`);
        await this.audit.record({
          tutorId: null,
          actorType: ActorType.SYSTEM,
          action: 'system.student.purged',
          entityType: 'Student',
          metadata: { count },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`student purge cron failed: ${message}`);
    }
  }
}
