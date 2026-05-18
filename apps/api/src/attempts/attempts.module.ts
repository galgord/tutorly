import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StudentsModule } from '../students/students.module';
import { AbandonedAttemptService } from './abandoned-attempt.service';
import { ATTEMPT_SAMPLER, AttemptService } from './attempt.service';
import { PublicAttemptsController } from './public-attempts.controller';
import { PublicStudentDashboardController } from './public-student-dashboard.controller';
import { sampleQuestions } from './question-sampler';

/**
 * Phase 6 attempts module — exposes the student-facing play endpoints
 * via `PublicAttemptsController` (mounted under `/s/:shareToken/...`)
 * and runs the hourly abandoned-attempt cron.
 *
 * StudentsModule is imported for `StudentTokenGuard` + `StudentService`
 * (the guard the controller uses to authorize the share token).
 */
@Module({
  imports: [AuditModule, StudentsModule],
  controllers: [PublicAttemptsController, PublicStudentDashboardController],
  providers: [
    AttemptService,
    AbandonedAttemptService,
    { provide: ATTEMPT_SAMPLER, useValue: sampleQuestions },
  ],
  exports: [AttemptService],
})
export class AttemptsModule {}
