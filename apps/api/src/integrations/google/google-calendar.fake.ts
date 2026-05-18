import { Injectable, Logger } from '@nestjs/common';
import {
  type GoogleCalendar,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  GoogleInvalidGrantError,
  type GoogleOAuthTokens,
  GoogleQuotaError,
  GoogleUnavailableError,
} from './google-calendar.client';

/**
 * In-memory fake of GoogleCalendarClient. Used in:
 *  - unit/integration tests (programmable via the `__set*` setters)
 *  - the test-only `__test__/google/*` route mounted in non-prod so
 *    Playwright can drive the full UI without real Google
 *
 * Defaults: returns two canned calendars (primary "Lessons" + "Personal")
 * and a single canned event 2 days in the past with id 'evt-past-1'.
 *
 * State is module-scoped so the seed route can manipulate the same instance
 * the controller uses (single-process dev). Resetting between tests is
 * caller's responsibility (call `fake.__reset()` in beforeEach).
 */
@Injectable()
export class FakeGoogleCalendarClient implements GoogleCalendarClient {
  private readonly logger = new Logger(FakeGoogleCalendarClient.name);

  // Refresh tokens we consider "valid" — anything else triggers invalid_grant
  // on listCalendars / listEvents. Seeded with two canonical fakes the test
  // route hands out.
  private validRefreshTokens = new Set<string>(['fake-refresh-valid', 'fake-refresh-valid-2']);
  // Set this to a refresh token to make the NEXT call with it throw
  // GoogleInvalidGrantError, then reset.
  private invalidatedRefreshTokens = new Set<string>();
  // Force quota error on the next list-calendars call.
  private forceQuotaOnNext = false;
  // Force unavailable error on the next list call.
  private forceUnavailableOnNext = false;

  private calendars: GoogleCalendar[] = [
    { id: 'cal-primary', summary: 'Lessons', primary: true, backgroundColor: '#3366cc' },
    { id: 'cal-secondary', summary: 'Personal', primary: false, backgroundColor: '#999999' },
  ];

  // Default events sit in the past so the calendar page has something
  // clickable. Tests overwrite via __setEvents.
  private events: GoogleCalendarEvent[] = [
    {
      id: 'evt-past-1',
      calendarId: 'cal-primary',
      title: 'Sara — Spanish lesson',
      startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 2 * 86_400_000 + 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'evt-future-1',
      calendarId: 'cal-primary',
      title: 'Sara — upcoming lesson',
      startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 86_400_000 + 60 * 60 * 1000).toISOString(),
    },
  ];

  // ---- GoogleCalendarClient surface --------------------------------------

  buildAuthUrl(opts: { state: string }): string {
    // Test routes never hit Google; this URL only needs to be inspectable
    // by tests/UI to assert the state was used.
    return `https://fake-google.invalid/oauth/authorize?state=${encodeURIComponent(opts.state)}`;
  }

  async exchangeCode(_opts: { code: string }): Promise<GoogleOAuthTokens> {
    return {
      refreshToken: 'fake-refresh-valid',
      accessToken: 'fake-access-valid',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      expiryDate: Date.now() + 3_600_000,
    };
  }

  async revokeRefreshToken(opts: { refreshToken: string }): Promise<void> {
    // Drop from valid set so subsequent uses would invalid_grant if reused.
    this.validRefreshTokens.delete(opts.refreshToken);
    this.logger.debug(`fake revoke called for ${opts.refreshToken.slice(0, 6)}…`);
  }

  async listCalendars(opts: { refreshToken: string }): Promise<GoogleCalendar[]> {
    this.failIfProgrammed(opts.refreshToken);
    return this.calendars.map((c) => ({ ...c }));
  }

  async listEvents(opts: {
    refreshToken: string;
    calendarIds: string[];
    from: Date;
    to: Date;
  }): Promise<GoogleCalendarEvent[]> {
    this.failIfProgrammed(opts.refreshToken);
    const fromMs = opts.from.getTime();
    const toMs = opts.to.getTime();
    return this.events.filter(
      (e) =>
        opts.calendarIds.includes(e.calendarId) &&
        new Date(e.startsAt).getTime() >= fromMs &&
        new Date(e.startsAt).getTime() <= toMs,
    );
  }

  // ---- Test-only setters --------------------------------------------------

  __reset(): void {
    this.validRefreshTokens = new Set(['fake-refresh-valid', 'fake-refresh-valid-2']);
    this.invalidatedRefreshTokens.clear();
    this.forceQuotaOnNext = false;
    this.forceUnavailableOnNext = false;
    this.calendars = [
      { id: 'cal-primary', summary: 'Lessons', primary: true, backgroundColor: '#3366cc' },
      { id: 'cal-secondary', summary: 'Personal', primary: false, backgroundColor: '#999999' },
    ];
    this.events = [
      {
        id: 'evt-past-1',
        calendarId: 'cal-primary',
        title: 'Sara — Spanish lesson',
        startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() - 2 * 86_400_000 + 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'evt-future-1',
        calendarId: 'cal-primary',
        title: 'Sara — upcoming lesson',
        startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 86_400_000 + 60 * 60 * 1000).toISOString(),
      },
    ];
  }

  __markRefreshInvalid(refreshToken: string): void {
    this.invalidatedRefreshTokens.add(refreshToken);
  }

  __setCalendars(items: GoogleCalendar[]): void {
    this.calendars = [...items];
  }

  __setEvents(events: GoogleCalendarEvent[]): void {
    this.events = [...events];
  }

  __forceQuotaOnNext(): void {
    this.forceQuotaOnNext = true;
  }

  __forceUnavailableOnNext(): void {
    this.forceUnavailableOnNext = true;
  }

  __addValidRefreshToken(t: string): void {
    this.validRefreshTokens.add(t);
  }

  private failIfProgrammed(refreshToken: string): void {
    if (this.invalidatedRefreshTokens.has(refreshToken) || !this.validRefreshTokens.has(refreshToken)) {
      throw new GoogleInvalidGrantError();
    }
    if (this.forceQuotaOnNext) {
      this.forceQuotaOnNext = false;
      throw new GoogleQuotaError();
    }
    if (this.forceUnavailableOnNext) {
      this.forceUnavailableOnNext = false;
      throw new GoogleUnavailableError();
    }
  }
}
