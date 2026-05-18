import { describe, expect, it } from 'vitest';
import {
  GoogleInvalidGrantError,
  GoogleQuotaError,
  GoogleUnavailableError,
} from './google-calendar.client';
import { FakeGoogleCalendarClient } from './google-calendar.fake';

describe('FakeGoogleCalendarClient', () => {
  it('buildAuthUrl bakes the state into the URL for inspection', () => {
    const fake = new FakeGoogleCalendarClient();
    expect(fake.buildAuthUrl({ state: 'st-1' })).toContain('state=st-1');
  });

  it('exchangeCode returns canned tokens', async () => {
    const fake = new FakeGoogleCalendarClient();
    const tokens = await fake.exchangeCode({ code: 'c' });
    expect(tokens.refreshToken).toBe('fake-refresh-valid');
    expect(tokens.scope).toContain('calendar.readonly');
  });

  it('listCalendars returns the canned set with the seeded valid token', async () => {
    const fake = new FakeGoogleCalendarClient();
    const cals = await fake.listCalendars({ refreshToken: 'fake-refresh-valid' });
    expect(cals.length).toBe(2);
    expect(cals[0]?.summary).toBe('Lessons');
  });

  it('listCalendars rejects unknown refresh tokens with invalid_grant', async () => {
    const fake = new FakeGoogleCalendarClient();
    await expect(fake.listCalendars({ refreshToken: 'nope' })).rejects.toBeInstanceOf(
      GoogleInvalidGrantError,
    );
  });

  it('listEvents filters by calendarIds and time range', async () => {
    const fake = new FakeGoogleCalendarClient();
    fake.__setEvents([
      { id: 'a', calendarId: 'cal-primary', title: 'in-range', startsAt: new Date(1_000_000).toISOString(), endsAt: null },
      { id: 'b', calendarId: 'cal-primary', title: 'out-of-range', startsAt: new Date(9_999_999_999_999).toISOString(), endsAt: null },
      { id: 'c', calendarId: 'other-cal', title: 'other-cal', startsAt: new Date(1_000_000).toISOString(), endsAt: null },
    ]);
    const got = await fake.listEvents({
      refreshToken: 'fake-refresh-valid',
      calendarIds: ['cal-primary'],
      from: new Date(0),
      to: new Date(2_000_000),
    });
    expect(got.map((e) => e.id)).toEqual(['a']);
  });

  it('__markRefreshInvalid forces invalid_grant on the next call', async () => {
    const fake = new FakeGoogleCalendarClient();
    fake.__markRefreshInvalid('fake-refresh-valid');
    await expect(fake.listCalendars({ refreshToken: 'fake-refresh-valid' })).rejects.toBeInstanceOf(
      GoogleInvalidGrantError,
    );
  });

  it('__forceQuotaOnNext fires quota error once then clears', async () => {
    const fake = new FakeGoogleCalendarClient();
    fake.__forceQuotaOnNext();
    await expect(fake.listCalendars({ refreshToken: 'fake-refresh-valid' })).rejects.toBeInstanceOf(
      GoogleQuotaError,
    );
    // Next call goes through.
    const ok = await fake.listCalendars({ refreshToken: 'fake-refresh-valid' });
    expect(ok.length).toBe(2);
  });

  it('__forceUnavailableOnNext fires unavailable error once', async () => {
    const fake = new FakeGoogleCalendarClient();
    fake.__forceUnavailableOnNext();
    await expect(fake.listCalendars({ refreshToken: 'fake-refresh-valid' })).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
  });

  it('revokeRefreshToken removes from valid set so subsequent calls fail', async () => {
    const fake = new FakeGoogleCalendarClient();
    await fake.revokeRefreshToken({ refreshToken: 'fake-refresh-valid' });
    await expect(fake.listCalendars({ refreshToken: 'fake-refresh-valid' })).rejects.toBeInstanceOf(
      GoogleInvalidGrantError,
    );
  });

  it('__addValidRefreshToken re-adds a previously revoked token', async () => {
    const fake = new FakeGoogleCalendarClient();
    await fake.revokeRefreshToken({ refreshToken: 'fake-refresh-valid' });
    fake.__addValidRefreshToken('fake-refresh-valid');
    const cals = await fake.listCalendars({ refreshToken: 'fake-refresh-valid' });
    expect(cals.length).toBe(2);
  });

  it('__reset restores everything to canonical defaults', async () => {
    const fake = new FakeGoogleCalendarClient();
    await fake.revokeRefreshToken({ refreshToken: 'fake-refresh-valid' });
    fake.__setEvents([]);
    fake.__reset();
    const cals = await fake.listCalendars({ refreshToken: 'fake-refresh-valid' });
    expect(cals.length).toBe(2);
    const events = await fake.listEvents({
      refreshToken: 'fake-refresh-valid',
      calendarIds: ['cal-primary'],
      from: new Date(0),
      to: new Date(Date.now() + 365 * 86_400_000),
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('__setCalendars overrides the canned set', async () => {
    const fake = new FakeGoogleCalendarClient();
    fake.__setCalendars([{ id: 'only-one', summary: 'OnlyOne' }]);
    const cals = await fake.listCalendars({ refreshToken: 'fake-refresh-valid' });
    expect(cals).toEqual([{ id: 'only-one', summary: 'OnlyOne' }]);
  });
});
