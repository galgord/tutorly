import { Injectable, Logger } from '@nestjs/common';
import { google, type Auth, type calendar_v3 } from 'googleapis';
import { ConfigService } from '../../config/config.service';
import {
  type GoogleCalendar,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  GoogleInvalidGrantError,
  type GoogleOAuthTokens,
  GoogleQuotaError,
  GoogleUnavailableError,
} from './google-calendar.client';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

/**
 * Real GoogleCalendarClient backed by the official `googleapis` SDK.
 *
 * IMPORTANT: this is never imported in tests — the spec calls for it to be
 * swapped out via the GOOGLE_CALENDAR_CLIENT DI token. Live exercise happens
 * only during the manual real-API walk-through documented in the phase gate.
 */
@Injectable()
export class RealGoogleCalendarClient implements GoogleCalendarClient {
  private readonly logger = new Logger(RealGoogleCalendarClient.name);

  constructor(private readonly config: ConfigService) {}

  buildAuthUrl(opts: { state: string }): string {
    const oauth = this.oauthClient();
    return oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // force a refresh-token issue on every connect
      scope: SCOPES,
      state: opts.state,
      include_granted_scopes: true,
    });
  }

  async exchangeCode(opts: { code: string }): Promise<GoogleOAuthTokens> {
    const oauth = this.oauthClient();
    try {
      const { tokens } = await oauth.getToken(opts.code);
      if (!tokens.refresh_token) {
        // The user already granted access — we'd need them to revoke + reconnect.
        throw new GoogleInvalidGrantError(
          'Google did not return a refresh token. Ask the user to remove and re-add the integration.',
        );
      }
      return {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? undefined,
        scope: tokens.scope ?? undefined,
        expiryDate: tokens.expiry_date ?? undefined,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async revokeRefreshToken(opts: { refreshToken: string }): Promise<void> {
    const oauth = this.oauthClient();
    oauth.setCredentials({ refresh_token: opts.refreshToken });
    try {
      await oauth.revokeToken(opts.refreshToken);
    } catch (err) {
      // Revoke is best-effort. If the token was already invalid we don't care.
      this.logger.warn(
        `google revokeToken failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listCalendars(opts: { refreshToken: string }): Promise<GoogleCalendar[]> {
    const calendar = await this.calendarFor(opts.refreshToken);
    try {
      const { data } = await calendar.calendarList.list({ maxResults: 250 });
      const items = data.items ?? [];
      return items.map((i) => ({
        id: i.id ?? '',
        summary: i.summary ?? '(unnamed calendar)',
        primary: i.primary ?? false,
        backgroundColor: i.backgroundColor ?? undefined,
      }));
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async listEvents(opts: {
    refreshToken: string;
    calendarIds: string[];
    from: Date;
    to: Date;
  }): Promise<GoogleCalendarEvent[]> {
    const calendar = await this.calendarFor(opts.refreshToken);
    const out: GoogleCalendarEvent[] = [];
    for (const calendarId of opts.calendarIds) {
      try {
        const { data } = await calendar.events.list({
          calendarId,
          timeMin: opts.from.toISOString(),
          timeMax: opts.to.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        });
        for (const e of data.items ?? []) {
          if (!e.id || !(e.start?.dateTime || e.start?.date)) continue;
          out.push({
            id: e.id,
            calendarId,
            title: e.summary ?? '(no title)',
            startsAt: e.start.dateTime
              ? new Date(e.start.dateTime).toISOString()
              : new Date(`${e.start.date}T00:00:00Z`).toISOString(),
            endsAt: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : null,
          });
        }
      } catch (err) {
        throw this.mapError(err);
      }
    }
    return out;
  }

  // ---- internals --------------------------------------------------------

  private oauthClient(): Auth.OAuth2Client {
    return new google.auth.OAuth2(
      this.config.get('GOOGLE_CLIENT_ID')!,
      this.config.get('GOOGLE_CLIENT_SECRET')!,
      this.config.get('GOOGLE_OAUTH_REDIRECT_URI')!,
    );
  }

  private async calendarFor(refreshToken: string): Promise<calendar_v3.Calendar> {
    const auth = this.oauthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth });
  }

  private mapError(err: unknown): Error {
    const e = err as {
      code?: number | string;
      message?: string;
      response?: { status?: number; data?: { error?: string; error_description?: string } };
    };
    const status = typeof e?.response?.status === 'number' ? e.response.status : Number(e?.code);
    const googleErrorBody = e?.response?.data?.error;
    // OAuth refresh failure.
    if (
      googleErrorBody === 'invalid_grant' ||
      (typeof e?.message === 'string' && /invalid_grant/i.test(e.message))
    ) {
      return new GoogleInvalidGrantError(e.message);
    }
    if (status === 403 || status === 429) {
      return new GoogleQuotaError(e.message);
    }
    if (status && status >= 500) {
      return new GoogleUnavailableError(e.message);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
