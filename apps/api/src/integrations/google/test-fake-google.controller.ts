import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard } from '../../auth/auth.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../../auth/current-tutor.decorator';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GOOGLE_CALENDAR_CLIENT,
  type GoogleCalendarClient,
} from './google-calendar.client';
import { FakeGoogleCalendarClient } from './google-calendar.fake';
import { encryptToken } from './token-crypto';

/**
 * Test-only seeder. Mounted ONLY when `NODE_ENV !== 'production'`. Lets
 * Playwright / curl simulate a completed OAuth flow without ever hitting
 * Google. Hard-coded refresh token matches what FakeGoogleCalendarClient
 * accepts.
 *
 * Body (all optional):
 *   - `calendarIds`: pre-select these as lesson sources
 *   - `events`: replace the fake's canned events with these
 *
 * Response:
 *   `{ ok: true, connected: true, lessonCalendarIds: string[] }`
 */
@Controller('__test__/google')
@UseGuards(AuthGuard, CsrfGuard)
export class TestFakeGoogleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(GOOGLE_CALENDAR_CLIENT) private readonly google: GoogleCalendarClient,
  ) {}

  @Post('fake-tokens')
  async seedConnection(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Body() body: { calendarIds?: string[]; events?: unknown[] } | undefined,
  ) {
    if (this.config.isProd()) {
      throw new ForbiddenException('Test routes disabled in production.');
    }
    const key = this.config.get('INTEGRATION_TOKEN_ENCRYPTION_KEY');
    if (!key) {
      throw new ForbiddenException(
        'INTEGRATION_TOKEN_ENCRYPTION_KEY must be set for the test-fake-tokens route.',
      );
    }

    // Per-tutor refresh token so parallel Playwright tests don't disconnect
    // each other when one of them revokes. We do NOT __reset() here — the
    // singleton fake is shared across tests; resetting would clobber another
    // in-flight test's state.
    const perTutorRefresh = `fake-refresh-valid-${tutor.id}`;
    if (this.google instanceof FakeGoogleCalendarClient) {
      this.google.__addValidRefreshToken(perTutorRefresh);
      if (Array.isArray(body?.events)) {
        this.google.__setEvents(body!.events as never);
      }
    }

    const calendarIds = Array.from(
      new Set((body?.calendarIds ?? []).filter((s): s is string => typeof s === 'string')),
    );

    const encrypted = encryptToken(perTutorRefresh, key);
    const updated = await this.prisma.tutor.update({
      where: { id: tutor.id },
      data: {
        googleRefreshToken: encrypted,
        lessonCalendarIds: calendarIds,
      },
      select: { lessonCalendarIds: true },
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.SYSTEM,
      action: 'integration.google.test.seeded',
      entityType: 'Tutor',
      entityId: tutor.id,
      metadata: { calendarCount: calendarIds.length },
    });

    return { ok: true, connected: true, lessonCalendarIds: updated.lessonCalendarIds };
  }
}
