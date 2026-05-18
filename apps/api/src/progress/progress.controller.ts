import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AttemptHistoryResponseSchema,
  ListAttemptsQuerySchema,
  StudentProgressResponseSchema,
  type AttemptHistoryResponse,
  type StudentProgressResponse,
} from '@tutor-app/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { StudentService } from '../students/student.service';
import { ProgressService } from './progress.service';

/**
 * Tutor-facing progress endpoints. Both routes verify the student belongs to
 * the session's tutor via `StudentService.getForTutorOrFail` (which 404s on
 * cross-tenant or missing) before calling the aggregation service.
 *
 * No CSRF — pure GETs.
 */
@Controller('students')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class ProgressController {
  constructor(
    private readonly students: StudentService,
    private readonly progress: ProgressService,
  ) {}

  @Get(':id/progress')
  async getProgress(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
  ): Promise<StudentProgressResponse> {
    const student = await this.students.getForTutorOrFail({ id, tutorId: tutor.id });
    const aggregated = await this.progress.getStudentProgress(student.id);
    // Re-parse through the wire schema so any drift between the math layer
    // and the public contract is caught at the boundary.
    return StudentProgressResponseSchema.parse(aggregated);
  }

  @Get(':id/attempts')
  async listAttempts(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<AttemptHistoryResponse> {
    const parsed = ListAttemptsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const student = await this.students.getForTutorOrFail({ id, tutorId: tutor.id });
    const out = await this.progress.listAttempts({
      studentId: student.id,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    return AttemptHistoryResponseSchema.parse(out);
  }
}
