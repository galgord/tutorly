import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActorType, GameStatus, GameType, type Game } from '@prisma/client';
import {
  CreateGameRequestSchema,
  GameListResponseSchema,
  GameResponseSchema,
  RegenerateQuestionRequestSchema,
  UpdateGameRequestSchema,
  type GameListResponse,
  type GameResponse,
  type Locale,
} from '@tutor-app/shared';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { GamesService, parsePool } from './games.service';

/**
 * Tutor-facing endpoints for game generation + review.
 *
 * Route shape:
 *   POST   /lessons/:lessonId/games        create + enqueue generation (202)
 *   GET    /lessons/:lessonId/games        list games for lesson
 *   GET    /games/:id                      fetch one (polled by review UI)
 *   PATCH  /games/:id                      edit title / questions
 *   POST   /games/:id/regenerate           re-run whole pool
 *   POST   /games/:id/regenerate-question  re-run one question
 *   POST   /games/:id/assign               DRAFT/FAILED → ASSIGNED
 *   DELETE /games/:id                      archive (soft delete)
 *
 * Tenant scoping: tutorId always derived from the session; every loader
 * funnels through GamesService.getForTutorOrFail or assertLessonOwned.
 */
@Controller()
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('lessons/:lessonId/games')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CsrfGuard)
  async create(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('lessonId') lessonId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GameResponse> {
    const parsed = CreateGameRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    // Resolve locale: per-request override > tutor's preference.
    const tutorRow = await this.prisma.tutor.findUnique({
      where: { id: tutor.id },
      select: { locale: true },
    });
    const locale: Locale = (parsed.data.locale ?? (tutorRow?.locale as Locale)) ?? 'en';

    const { game, breakerOpen } = await this.games.createAndEnqueue({
      lessonId,
      tutorId: tutor.id,
      type: parsed.data.type === 'FILL_BLANK' ? GameType.FILL_BLANK : GameType.TIMED_QUIZ,
      poolSize: parsed.data.poolSize,
      locale,
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'game.generation.enqueued',
      entityType: 'Game',
      entityId: game.id,
      metadata: {
        type: game.type,
        poolSize: game.poolSize,
        locale,
        breakerOpen,
      },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    if (breakerOpen) {
      // Still return 202 (the request was *accepted*) but with the
      // FAILED game so the UI can surface the "AI temporarily unavailable"
      // banner immediately on its first poll.
      res.setHeader('x-ai-circuit-breaker', 'open');
    }
    return serializeGame(game);
  }

  @Get('lessons/:lessonId/games')
  async list(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('lessonId') lessonId: string,
  ): Promise<GameListResponse> {
    const items = await this.games.listForLesson({ lessonId, tutorId: tutor.id });
    return GameListResponseSchema.parse({ items: items.map(serializeGame) });
  }

  @Get('games/:id')
  async get(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
  ): Promise<GameResponse> {
    const game = await this.games.getForTutorOrFail({ id, tutorId: tutor.id });
    return serializeGame(game);
  }

  @Patch('games/:id')
  @UseGuards(CsrfGuard)
  async edit(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<GameResponse> {
    const parsed = UpdateGameRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    if (!parsed.data.title && !parsed.data.questions) {
      throw new BadRequestException('Provide a title or questions to update.');
    }
    const game = await this.games.editQuestions({
      id,
      tutorId: tutor.id,
      title: parsed.data.title,
      questions: parsed.data.questions,
    });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'game.edited',
      entityType: 'Game',
      entityId: game.id,
      metadata: {
        titleChanged: !!parsed.data.title,
        questionCount: parsed.data.questions?.length,
      },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return serializeGame(game);
  }

  @Post('games/:id/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CsrfGuard)
  async regenerate(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<GameResponse> {
    const game = await this.games.regenerateAll({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'game.regenerated',
      entityType: 'Game',
      entityId: game.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return serializeGame(game);
  }

  @Post('games/:id/regenerate-question')
  @UseGuards(CsrfGuard)
  async regenerateOne(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<GameResponse> {
    const parsed = RegenerateQuestionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const game = await this.games.regenerateOneQuestion({
      id,
      tutorId: tutor.id,
      questionId: parsed.data.questionId,
    });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'game.question.regenerated',
      entityType: 'Game',
      entityId: game.id,
      metadata: { questionId: parsed.data.questionId },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return serializeGame(game);
  }

  @Post('games/:id/assign')
  @UseGuards(CsrfGuard)
  async assign(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<GameResponse> {
    const game = await this.games.assign({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'game.assigned',
      entityType: 'Game',
      entityId: game.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return serializeGame(game);
  }

  @Delete('games/:id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async remove(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const game = await this.games.softDelete({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'game.deleted',
      entityType: 'Game',
      entityId: game.id,
      metadata: { archivedWithAttempts: !game.deletedAt && game.status === GameStatus.ARCHIVED },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
  }
}

export function serializeGame(g: Game): GameResponse {
  return GameResponseSchema.parse({
    id: g.id,
    lessonId: g.lessonId,
    type: g.type,
    title: g.title,
    status: g.status,
    questionPool: parsePool(g.questionPool),
    poolSize: g.poolSize,
    locale: g.locale,
    generationError: g.generationError,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
    assignedAt: g.assignedAt ? g.assignedAt.toISOString() : null,
  });
}

function clientIp(req: Request): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}
