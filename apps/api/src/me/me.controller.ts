import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { MeResponseSchema, UpdateTutorRequestSchema } from '@tutor-app/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedCookieOptions,
} from '../auth/cookie';
import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async me(@CurrentTutor() tutor: CurrentTutorPayload) {
    return MeResponseSchema.parse({
      id: tutor.id,
      email: tutor.email,
      name: tutor.name,
      locale: tutor.locale,
    });
  }

  @Patch()
  @UseGuards(CsrfGuard)
  async update(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = UpdateTutorRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const updated = await this.prisma.tutor.update({
      where: { id: tutor.id },
      data: {
        name: parsed.data.name ?? undefined,
        locale: parsed.data.locale ?? undefined,
      },
      select: { id: true, email: true, name: true, locale: true },
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'tutor.profile.updated',
      entityType: 'Tutor',
      entityId: tutor.id,
      metadata: { fields: Object.keys(parsed.data) },
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    return MeResponseSchema.parse(updated);
  }

  @Get('export')
  async exportData(@CurrentTutor() tutor: CurrentTutorPayload, @Req() req: AuthedRequest) {
    const data = await this.prisma.tutor.findUnique({
      where: { id: tutor.id },
      include: {
        students: {
          include: {
            lessons: { include: { games: true } },
            attempts: true,
          },
        },
      },
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'tutor.data.exported',
      entityType: 'Tutor',
      entityId: tutor.id,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    return {
      exportedAt: new Date().toISOString(),
      tutor: data,
    };
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async deleteAccount(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    // Soft-delete; a cron in Phase 10 purges after grace period.
    await this.prisma.tutor.update({
      where: { id: tutor.id },
      data: { deletedAt: new Date() },
    });
    await this.sessions.revokeAllForTutor(tutor.id);

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'tutor.account.deleted',
      entityType: 'Tutor',
      entityId: tutor.id,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    const isProd = this.config.isProd();
    res.clearCookie(SESSION_COOKIE_NAME, clearedCookieOptions(isProd));
    res.clearCookie(CSRF_COOKIE_NAME, { ...clearedCookieOptions(isProd), httpOnly: false });
    res.send();
  }
}
