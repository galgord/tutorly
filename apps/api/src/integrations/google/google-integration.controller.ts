import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ConnectIntegrationResponseSchema,
  IntegrationStatusResponseSchema,
  ListCalendarsResponseSchema,
  UpdateLessonCalendarsRequestSchema,
} from '@tutor-app/shared';
import { ConfigService } from '../../config/config.service';
import { AuthGuard, type AuthedRequest } from '../../auth/auth.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../../auth/current-tutor.decorator';
import { GoogleIntegrationService } from './google-integration.service';
import { OAuthStateService } from './oauth-state.service';

/**
 * Tutor-facing endpoints for the Google Calendar integration.
 *
 * /callback is the one exception to the AuthGuard rule — Google's redirect
 * does NOT carry a session cookie reliably across browsers (cookies marked
 * SameSite=Lax do survive top-level navigations like this one, but some
 * privacy modes strip them). We instead bind ownership through the OAuth
 * state we issued at /connect.
 */
@Controller('integrations/google')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class GoogleIntegrationController {
  constructor(
    private readonly integration: GoogleIntegrationService,
    private readonly oauthState: OAuthStateService,
    private readonly config: ConfigService,
  ) {}

  @Post('connect')
  @HttpCode(200)
  @UseGuards(AuthGuard, CsrfGuard)
  async connect(@CurrentTutor() tutor: CurrentTutorPayload) {
    const state = await this.oauthState.issue({ tutorId: tutor.id });
    const authUrl = this.integration.buildAuthUrl({ state });
    return ConnectIntegrationResponseSchema.parse({ authUrl });
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') errorParam: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    if (errorParam) {
      // User declined the consent screen, or Google returned an error.
      // Bounce back to the integrations page with a flag the UI can render.
      const url = `${this.config.get('WEB_ORIGIN')}/settings/integrations?connected=0&error=${encodeURIComponent(
        errorParam,
      )}`;
      return res.redirect(302, url);
    }
    if (!code) throw new BadRequestException('Missing OAuth code.');
    if (!state) throw new BadRequestException('Missing OAuth state.');

    const { tutorId } = await this.oauthState.consume({ state });
    await this.integration.completeConnect({
      tutorId,
      code,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent'),
    });
    res.redirect(302, `${this.config.get('WEB_ORIGIN')}/settings/integrations?connected=1`);
  }

  @Delete('disconnect')
  @HttpCode(204)
  @UseGuards(AuthGuard, CsrfGuard)
  async disconnect(@CurrentTutor() tutor: CurrentTutorPayload, @Req() req: AuthedRequest) {
    await this.integration.disconnect({
      tutorId: tutor.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent'),
    });
  }

  @Get('calendars')
  @UseGuards(AuthGuard)
  async listCalendars(@CurrentTutor() tutor: CurrentTutorPayload) {
    const result = await this.integration.listCalendars(tutor.id);
    if (!result.ok) return { error: result.error };
    return ListCalendarsResponseSchema.parse({ items: result.items });
  }

  @Patch('lesson-calendars')
  @UseGuards(AuthGuard, CsrfGuard)
  async setLessonCalendars(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = UpdateLessonCalendarsRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.integration.setLessonCalendarIds({
      tutorId: tutor.id,
      calendarIds: parsed.data.calendarIds,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent'),
    });
  }

  @Get('status')
  @UseGuards(AuthGuard)
  async status(@CurrentTutor() tutor: CurrentTutorPayload) {
    const s = await this.integration.status(tutor.id);
    return IntegrationStatusResponseSchema.parse(s);
  }
}

function clientIp(req: AuthedRequest): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}
