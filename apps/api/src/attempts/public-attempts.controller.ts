import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActorType, GameType } from '@prisma/client';
import {
  FinishAttemptResponseSchema,
  PublicQuestionSchema,
  StartAttemptResponseSchema,
  SubmitAnswerRequestSchema,
  SubmitAnswerResponseSchema,
  type FinishAttemptResponse,
  type StartAttemptResponse,
  type SubmitAnswerResponse,
} from '@tutor-app/shared';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import {
  StudentTokenGuard,
  type StudentTokenRequest,
} from '../students/student-token.guard';
import { AttemptService } from './attempt.service';

/**
 * Student-facing attempt lifecycle. Token-gated (no session, no CSRF).
 *
 *   POST   /s/:shareToken/games/:gameId/attempts          start an attempt
 *   PATCH  /s/:shareToken/attempts/:attemptId/answers     submit one answer
 *   POST   /s/:shareToken/attempts/:attemptId/finish      finish + summary
 *
 * Throttling is the global per-IP cap from the share-token controller
 * (20 req/min/IP); play sessions are 10-20 answers in a few minutes,
 * comfortably under.
 */
@Controller('s/:shareToken')
@UseGuards(StudentTokenGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicAttemptsController {
  constructor(
    private readonly attempts: AttemptService,
    private readonly audit: AuditService,
  ) {}

  // ---- Start ----------------------------------------------------------

  @Post('games/:gameId/attempts')
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Param('gameId') gameId: string,
    @Req() req: StudentTokenRequest,
  ): Promise<StartAttemptResponse> {
    const student = req.student!;
    const r = await this.attempts.startAttempt({ student, gameId });

    // For TIMED_QUIZ, freeze the per-question choices server-side and
    // re-read them so the response shape carries the SAME order the
    // scorer will use.
    let choicesByQuestion: Record<string, string[]> = {};
    if (r.type === GameType.TIMED_QUIZ) {
      await this.attempts.freezeChoices(r.attempt.id);
      choicesByQuestion = await this.attempts.publicChoicesForAttempt(
        r.attempt.id,
        student,
      );
    }

    await this.audit.record({
      tutorId: null,
      actorType: ActorType.STUDENT,
      action: 'attempt.started',
      entityType: 'Attempt',
      entityId: r.attempt.id,
      metadata: { gameId: r.attempt.gameId, count: r.questions.length },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    return StartAttemptResponseSchema.parse({
      attemptId: r.attempt.id,
      gameId: r.attempt.gameId,
      type: r.type,
      locale: r.locale,
      livesAllowed: r.livesAllowed,
      perQuestionSeconds: r.perQuestionSeconds,
      level: r.level,
      levelMax: r.levelMax,
      questions: r.questions.map((q) =>
        PublicQuestionSchema.parse({
          id: q.id,
          prompt: q.prompt,
          choices: r.type === GameType.TIMED_QUIZ ? choicesByQuestion[q.id] ?? [] : [],
          topicTags: q.topicTags,
        }),
      ),
    });
  }

  // ---- Submit answer --------------------------------------------------

  @Patch('attempts/:attemptId/answers')
  async submit(
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @Req() req: StudentTokenRequest,
  ): Promise<SubmitAnswerResponse> {
    const student = req.student!;
    const parsed = SubmitAnswerRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const r = await this.attempts.submitAnswer({
      student,
      attemptId,
      questionId: parsed.data.questionId,
      rawAnswer: parsed.data.rawAnswer,
      choiceIndex: parsed.data.choiceIndex,
      timedOut: parsed.data.timedOut,
    });

    await this.audit.record({
      tutorId: null,
      actorType: ActorType.STUDENT,
      action: 'attempt.answered',
      entityType: 'Attempt',
      entityId: attemptId,
      // Critically: never include the raw answer / prompt text — PII-adjacent.
      metadata: { correct: r.record.correct, scoreSoFar: r.scoreSoFar },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    return SubmitAnswerResponseSchema.parse({
      questionId: r.record.questionId,
      correct: r.record.correct,
      correctAnswer: r.record.expectedAnswer,
      scoreSoFar: r.scoreSoFar,
      ...(r.livesRemaining !== undefined ? { livesRemaining: r.livesRemaining } : {}),
      gameOver: r.gameOver,
    });
  }

  // ---- Finish ---------------------------------------------------------

  @Post('attempts/:attemptId/finish')
  @HttpCode(HttpStatus.OK)
  async finish(
    @Param('attemptId') attemptId: string,
    @Req() req: StudentTokenRequest,
  ): Promise<FinishAttemptResponse> {
    const student = req.student!;
    const r = await this.attempts.finishAttempt({ student, attemptId });

    await this.audit.record({
      tutorId: null,
      actorType: ActorType.STUDENT,
      action: 'attempt.finished',
      entityType: 'Attempt',
      entityId: attemptId,
      metadata: { score: r.attempt.score, livesLost: r.attempt.livesLost },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    return FinishAttemptResponseSchema.parse({
      attemptId: r.attempt.id,
      gameId: r.attempt.gameId,
      score: r.attempt.score,
      total: r.totalQuestions,
      livesLost: r.attempt.livesLost,
      finishedAt: (r.attempt.finishedAt ?? new Date()).toISOString(),
      bestEver: r.bestEver,
      level: r.level,
      nextLevel: r.nextLevel,
      leveledUp: r.leveledUp,
    });
  }
}

function clientIp(req: Request): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}
