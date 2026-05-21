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
    // The auth guard's payload doesn't carry subject/teachingLanguage (they
    // were added in Phase 11), so we re-read them from the DB. Cheap (single
    // row, indexed) and avoids growing the session payload.
    const row = await this.prisma.tutor.findUnique({
      where: { id: tutor.id },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        subject: true,
        teachingLanguage: true,
        monthlyGenerations: true,
        monthlyGenerationsResetAt: true,
      },
    });
    return MeResponseSchema.parse({
      id: row?.id ?? tutor.id,
      email: row?.email ?? tutor.email,
      name: row?.name ?? tutor.name,
      locale: row?.locale ?? tutor.locale,
      subject: row?.subject ?? null,
      teachingLanguage: row?.teachingLanguage ?? null,
      monthlyGenerations: row?.monthlyGenerations ?? 0,
      monthlyGenerationsCap: this.config.get('GAME_GEN_MONTHLY_CAP'),
      monthlyGenerationsResetAt: (row?.monthlyGenerationsResetAt ?? new Date()).toISOString(),
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
        // `null` is meaningful (clear the field); `undefined` (key absent)
        // leaves it untouched. Zod gives us `undefined` when the key wasn't
        // sent, so the ternary is safe.
        subject:
          parsed.data.subject === undefined
            ? undefined
            : parsed.data.subject === null
              ? null
              : parsed.data.subject.trim(),
        teachingLanguage:
          parsed.data.teachingLanguage === undefined ? undefined : parsed.data.teachingLanguage,
      },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        subject: true,
        teachingLanguage: true,
        monthlyGenerations: true,
        monthlyGenerationsResetAt: true,
      },
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

    return MeResponseSchema.parse({
      ...updated,
      monthlyGenerationsCap: this.config.get('GAME_GEN_MONTHLY_CAP'),
      monthlyGenerationsResetAt: updated.monthlyGenerationsResetAt.toISOString(),
    });
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
