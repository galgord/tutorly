import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PublicGameSummarySchema,
  PublicStudentDashboardResponseSchema,
  type PublicStudentDashboardResponse,
} from '@tutor-app/shared';
import {
  StudentTokenGuard,
  type StudentTokenRequest,
} from '../students/student-token.guard';
import { AttemptService } from './attempt.service';

/**
 * Phase 6 student dashboard: ASSIGNED games + per-game "last played" /
 * "best score" badges. Token-gated, no session, no CSRF. Lives here
 * (not in StudentsModule) because it depends on AttemptService —
 * keeping the games/attempts data layer out of StudentsModule.
 */
@Controller('s/:shareToken')
@UseGuards(StudentTokenGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicStudentDashboardController {
  constructor(private readonly attempts: AttemptService) {}

  @Get('dashboard')
  async getDashboard(@Req() req: StudentTokenRequest): Promise<PublicStudentDashboardResponse> {
    const student = req.student!;
    const games = await this.attempts.listAssignedGamesForStudent(student);
    return PublicStudentDashboardResponseSchema.parse({
      name: student.name,
      games: games.map((g) =>
        PublicGameSummarySchema.parse({
          id: g.game.id,
          type: g.game.type,
          title: g.game.title,
          locale: g.game.locale,
          poolSize: g.game.poolSize,
          lastPlayedAt: g.lastPlayedAt ? g.lastPlayedAt.toISOString() : null,
          bestScore: g.bestScore,
          currentLevel: g.currentLevel,
        }),
      ),
    });
  }
}
