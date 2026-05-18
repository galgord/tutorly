import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GOOGLE_CALENDAR_CLIENT,
  type GoogleCalendar,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  GoogleInvalidGrantError,
  GoogleQuotaError,
  GoogleUnavailableError,
} from './google-calendar.client';
import { decryptToken, encryptToken } from './token-crypto';

interface CalendarsResult {
  ok: true;
  items: GoogleCalendar[];
}
interface CalendarsError {
  ok: false;
  error: 'quota_exceeded' | 'disconnected' | 'unavailable';
}
export type CalendarsListing = CalendarsResult | CalendarsError;

interface EventsResult {
  ok: true;
  events: GoogleCalendarEvent[];
}
interface EventsError {
  ok: false;
  error: 'quota_exceeded' | 'disconnected' | 'unavailable';
}
export type EventsListing = EventsResult | EventsError;

/**
 * Tutor-facing operations against the Google Calendar integration.
 * Encryption + invalidation handling live here so the controllers stay thin.
 */
@Injectable()
export class GoogleIntegrationService {
  private readonly logger = new Logger(GoogleIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(GOOGLE_CALENDAR_CLIENT) private readonly google: GoogleCalendarClient,
  ) {}

  /** Build the Google OAuth URL with a signed state. State row is created by the caller. */
  buildAuthUrl(opts: { state: string }): string {
    return this.google.buildAuthUrl(opts);
  }

  /** Exchange a code for tokens and persist (encrypted) on the tutor row. */
  async completeConnect(opts: {
    tutorId: string;
    code: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    const tokens = await this.google.exchangeCode({ code: opts.code });
    const encrypted = encryptToken(tokens.refreshToken, this.requireKey());

    await this.prisma.tutor.update({
      where: { id: opts.tutorId },
      data: { googleRefreshToken: encrypted },
    });
    await this.audit.record({
      tutorId: opts.tutorId,
      actorType: ActorType.TUTOR,
      action: 'integration.google.connected',
      entityType: 'Tutor',
      entityId: opts.tutorId,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    });
  }

  /** Best-effort revoke + clear local state. */
  async disconnect(opts: {
    tutorId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    const tutor = await this.prisma.tutor.findUnique({
      where: { id: opts.tutorId },
      select: { googleRefreshToken: true },
    });
    if (tutor?.googleRefreshToken) {
      try {
        const refresh = decryptToken(tutor.googleRefreshToken, this.requireKey());
        await this.google.revokeRefreshToken({ refreshToken: refresh });
      } catch (err) {
        // Either decrypt failed (key rotation) or revoke threw — either way
        // we still want to wipe local state below. Log + move on.
        this.logger.warn(
          `disconnect: revoke failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.prisma.tutor.update({
      where: { id: opts.tutorId },
      data: { googleRefreshToken: null, lessonCalendarIds: [] },
    });
    await this.audit.record({
      tutorId: opts.tutorId,
      actorType: ActorType.TUTOR,
      action: 'integration.google.disconnected',
      entityType: 'Tutor',
      entityId: opts.tutorId,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    });
  }

  /** Lightweight read used by the UI to decide which integration UI to show. */
  async status(tutorId: string): Promise<{ connected: boolean; lessonCalendarIds: string[] }> {
    const t = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { googleRefreshToken: true, lessonCalendarIds: true },
    });
    if (!t) return { connected: false, lessonCalendarIds: [] };
    return { connected: !!t.googleRefreshToken, lessonCalendarIds: t.lessonCalendarIds ?? [] };
  }

  /** List the tutor's calendars from Google. Surfaces typed errors. */
  async listCalendars(tutorId: string): Promise<CalendarsListing> {
    const refresh = await this.getRefreshOrNull(tutorId);
    if (!refresh) return { ok: false, error: 'disconnected' };
    try {
      const items = await this.google.listCalendars({ refreshToken: refresh });
      return { ok: true, items };
    } catch (err) {
      if (err instanceof GoogleInvalidGrantError) {
        await this.handleInvalidGrant(tutorId);
        return { ok: false, error: 'disconnected' };
      }
      if (err instanceof GoogleQuotaError) return { ok: false, error: 'quota_exceeded' };
      if (err instanceof GoogleUnavailableError) return { ok: false, error: 'unavailable' };
      throw err;
    }
  }

  async listEventsForTutor(opts: {
    tutorId: string;
    from: Date;
    to: Date;
  }): Promise<EventsListing> {
    const tutor = await this.prisma.tutor.findUnique({
      where: { id: opts.tutorId },
      select: { googleRefreshToken: true, lessonCalendarIds: true },
    });
    if (!tutor?.googleRefreshToken) return { ok: false, error: 'disconnected' };
    if (!tutor.lessonCalendarIds || tutor.lessonCalendarIds.length === 0)
      return { ok: true, events: [] };
    let refresh: string;
    try {
      refresh = decryptToken(tutor.googleRefreshToken, this.requireKey());
    } catch {
      // Stored token is unusable (key rotation). Force a reconnect.
      await this.handleInvalidGrant(opts.tutorId);
      return { ok: false, error: 'disconnected' };
    }
    try {
      const events = await this.google.listEvents({
        refreshToken: refresh,
        calendarIds: tutor.lessonCalendarIds,
        from: opts.from,
        to: opts.to,
      });
      return { ok: true, events };
    } catch (err) {
      if (err instanceof GoogleInvalidGrantError) {
        await this.handleInvalidGrant(opts.tutorId);
        return { ok: false, error: 'disconnected' };
      }
      if (err instanceof GoogleQuotaError) return { ok: false, error: 'quota_exceeded' };
      if (err instanceof GoogleUnavailableError) return { ok: false, error: 'unavailable' };
      throw err;
    }
  }

  async setLessonCalendarIds(opts: {
    tutorId: string;
    calendarIds: string[];
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ lessonCalendarIds: string[] }> {
    // De-dupe, drop empties.
    const unique = Array.from(new Set(opts.calendarIds.map((s) => s.trim()).filter(Boolean)));
    const tutor = await this.prisma.tutor.update({
      where: { id: opts.tutorId },
      data: { lessonCalendarIds: unique },
      select: { lessonCalendarIds: true },
    });
    await this.audit.record({
      tutorId: opts.tutorId,
      actorType: ActorType.TUTOR,
      action: 'integration.google.calendars.updated',
      entityType: 'Tutor',
      entityId: opts.tutorId,
      metadata: { count: unique.length },
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    });
    return { lessonCalendarIds: tutor.lessonCalendarIds };
  }

  // ---- internals --------------------------------------------------------

  private async getRefreshOrNull(tutorId: string): Promise<string | null> {
    const t = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      select: { googleRefreshToken: true },
    });
    if (!t?.googleRefreshToken) return null;
    try {
      return decryptToken(t.googleRefreshToken, this.requireKey());
    } catch {
      // Encrypted blob is unusable; treat as disconnected for safety.
      await this.handleInvalidGrant(tutorId);
      return null;
    }
  }

  private async handleInvalidGrant(tutorId: string): Promise<void> {
    await this.prisma.tutor.update({
      where: { id: tutorId },
      data: { googleRefreshToken: null, lessonCalendarIds: [] },
    });
    await this.audit.record({
      tutorId,
      actorType: ActorType.SYSTEM,
      action: 'integration.google.invalidated',
      entityType: 'Tutor',
      entityId: tutorId,
    });
  }

  private requireKey(): string {
    const key = this.config.get('INTEGRATION_TOKEN_ENCRYPTION_KEY');
    if (!key) {
      // Defensive; env.ts already validates this whenever Google envs are set.
      throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY is required to use the Google integration.');
    }
    return key;
  }
}
