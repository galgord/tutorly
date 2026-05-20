import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GamesModule } from '../games/games.module';
import { StudentsModule } from '../students/students.module';
import { AbandonedAttemptService } from './abandoned-attempt.service';
import { selectAttemptQuestions } from './adaptive-selector';
import { ADAPTIVE_SELECTOR, AttemptService } from './attempt.service';
import { PublicAttemptsController } from './public-attempts.controller';
import { PublicStudentDashboardController } from './public-student-dashboard.controller';
import { QuestionReviewService } from './question-review.service';
import { StudentGameProgressService } from './student-game-progress.service';

/**
 * Phase 6 attempts module — exposes the student-facing play endpoints
 * via `PublicAttemptsController` (mounted under `/s/:shareToken/...`)
 * and runs the hourly abandoned-attempt cron.
 *
 * StudentsModule is imported for `StudentTokenGuard` + `StudentService`
 * (the guard the controller uses to authorize the share token).
 *
 * Phase 12: the flat sampler is replaced by `selectAttemptQuestions` (adaptive
 * difficulty + non-repetition), and StudentGameProgressService persists the
 * cross-play level + seen-question state.
 */
@Module({
  imports: [AuditModule, StudentsModule, GamesModule],
  controllers: [PublicAttemptsController, PublicStudentDashboardController],
  providers: [
    AttemptService,
    AbandonedAttemptService,
    StudentGameProgressService,
    QuestionReviewService,
    { provide: ADAPTIVE_SELECTOR, useValue: selectAttemptQuestions },
  ],
  exports: [AttemptService],
})
export class AttemptsModule {}
