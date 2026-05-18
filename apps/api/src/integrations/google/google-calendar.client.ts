/**
 * Injection seam between the api and the Google Calendar SDK.
 *
 * The real implementation in `google-calendar.real.ts` is backed by
 * `googleapis`. Tests inject `FakeGoogleCalendarClient` (in `google-calendar.fake.ts`)
 * which returns canned data and can be programmed to simulate
 * `invalid_grant`, quota errors, etc.
 *
 * The interface is intentionally small — only the surface area the api
 * actually uses, so the test fake stays simple to maintain.
 */

export interface GoogleOAuthTokens {
  refreshToken: string;
  accessToken?: string;
  scope?: string;
  expiryDate?: number;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  startsAt: string; // ISO 8601 UTC
  endsAt: string | null; // ISO 8601 UTC; null for all-day events without end
}

/**
 * Typed errors the client surface contracts. Real implementation maps
 * Google's SDK errors to these so callers don't depend on googleapis
 * internals.
 */
export class GoogleInvalidGrantError extends Error {
  constructor(message = 'Google refresh token is no longer valid.') {
    super(message);
    this.name = 'GoogleInvalidGrantError';
  }
}

export class GoogleQuotaError extends Error {
  constructor(message = 'Google API quota exceeded.') {
    super(message);
    this.name = 'GoogleQuotaError';
  }
}

export class GoogleUnavailableError extends Error {
  constructor(message = 'Google API is temporarily unavailable.') {
    super(message);
    this.name = 'GoogleUnavailableError';
  }
}

export interface GoogleCalendarClient {
  /** Build the URL the tutor visits to grant calendar.readonly. */
  buildAuthUrl(opts: { state: string }): string;

  /** Exchange the auth code from the callback for refresh + access tokens. */
  exchangeCode(opts: { code: string }): Promise<GoogleOAuthTokens>;

  /** Best-effort revoke; safe to ignore failures. */
  revokeRefreshToken(opts: { refreshToken: string }): Promise<void>;

  /** List calendars the connected account can read. */
  listCalendars(opts: { refreshToken: string }): Promise<GoogleCalendar[]>;

  /** List events across the given calendar ids within [from, to]. */
  listEvents(opts: {
    refreshToken: string;
    calendarIds: string[];
    from: Date;
    to: Date;
  }): Promise<GoogleCalendarEvent[]>;
}

/**
 * Symbol token used in the Nest DI container so callers can swap the
 * implementation per-environment (real vs fake). Modules register a
 * `{ provide: GOOGLE_CALENDAR_CLIENT, useClass: ... }` provider.
 */
export const GOOGLE_CALENDAR_CLIENT = Symbol('GOOGLE_CALENDAR_CLIENT');
