import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../audit/audit.service';
import { makeConfigStub } from '../../test/fixtures';
import { makePrismaMock } from '../../test/prisma-mock';
import { FakeGoogleCalendarClient } from './google-calendar.fake';
import { GoogleInvalidGrantError, GoogleQuotaError, GoogleUnavailableError } from './google-calendar.client';
import { GoogleIntegrationService } from './google-integration.service';
import { decryptToken, encryptToken } from './token-crypto';

const TEST_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

function makeService() {
  const prisma = makePrismaMock();
  const config = makeConfigStub({ INTEGRATION_TOKEN_ENCRYPTION_KEY: TEST_KEY });
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const fake = new FakeGoogleCalendarClient();
  const svc = new GoogleIntegrationService(prisma, audit, config, fake);
  return { svc, prisma, audit, fake };
}

describe('GoogleIntegrationService.buildAuthUrl', () => {
  it('delegates to the client with the state value', () => {
    const { svc, fake } = makeService();
    const spy = vi.spyOn(fake, 'buildAuthUrl');
    svc.buildAuthUrl({ state: 'state-abc' });
    expect(spy).toHaveBeenCalledWith({ state: 'state-abc' });
  });
});

describe('GoogleIntegrationService.completeConnect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exchanges the code, encrypts the refresh token, and audits', async () => {
    const { svc, prisma, audit, fake } = makeService();
    const spy = vi.spyOn(fake, 'exchangeCode').mockResolvedValue({
      refreshToken: 'rt-xyz',
      accessToken: 'at-xyz',
      scope: 'cal',
      expiryDate: Date.now() + 1000,
    });
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);

    await svc.completeConnect({ tutorId: 'tutor_a', code: 'code-1', ipAddress: '1.1.1.1' });
    expect(spy).toHaveBeenCalledWith({ code: 'code-1' });

    const updateArgs = vi.mocked(prisma.tutor.update).mock.calls[0]?.[0];
    const stored = updateArgs?.data.googleRefreshToken as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toBe('rt-xyz'); // encrypted, not plaintext
    expect(decryptToken(stored, TEST_KEY)).toBe('rt-xyz');

    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.google.connected', tutorId: 'tutor_a' }),
    );
  });
});

describe('GoogleIntegrationService.disconnect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes (best-effort), clears state, audits', async () => {
    const { svc, prisma, audit, fake } = makeService();
    const encrypted = encryptToken('rt-xyz', TEST_KEY);
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({ googleRefreshToken: encrypted } as never);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    const revokeSpy = vi.spyOn(fake, 'revokeRefreshToken').mockResolvedValue(undefined);

    await svc.disconnect({ tutorId: 'tutor_a' });
    expect(revokeSpy).toHaveBeenCalledWith({ refreshToken: 'rt-xyz' });
    const updateArgs = vi.mocked(prisma.tutor.update).mock.calls[0]?.[0];
    expect(updateArgs?.data.googleRefreshToken).toBeNull();
    expect(updateArgs?.data.lessonCalendarIds).toEqual([]);
    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.google.disconnected' }),
    );
  });

  it('still clears state when no refresh token is stored', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({ googleRefreshToken: null } as never);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    const revokeSpy = vi.spyOn(fake, 'revokeRefreshToken');
    await svc.disconnect({ tutorId: 'tutor_a' });
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.tutor.update).mock.calls[0]?.[0].data.googleRefreshToken).toBeNull();
  });

  it('absorbs revoke failure and still clears local state', async () => {
    const { svc, prisma, fake } = makeService();
    const encrypted = encryptToken('rt-xyz', TEST_KEY);
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({ googleRefreshToken: encrypted } as never);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    vi.spyOn(fake, 'revokeRefreshToken').mockRejectedValue(new Error('boom'));
    await svc.disconnect({ tutorId: 'tutor_a' });
    expect(vi.mocked(prisma.tutor.update).mock.calls[0]?.[0].data.googleRefreshToken).toBeNull();
  });
});

describe('GoogleIntegrationService.status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disconnected when no row', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue(null);
    expect(await svc.status('tutor_a')).toEqual({ connected: false, lessonCalendarIds: [] });
  });

  it('returns connected:true and the lessonCalendarIds', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
      lessonCalendarIds: ['c1', 'c2'],
    } as never);
    expect(await svc.status('tutor_a')).toEqual({
      connected: true,
      lessonCalendarIds: ['c1', 'c2'],
    });
  });
});

describe('GoogleIntegrationService.listCalendars', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disconnected when no refresh token', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({ googleRefreshToken: null } as never);
    expect(await svc.listCalendars('tutor_a')).toEqual({ ok: false, error: 'disconnected' });
  });

  it('decrypts and returns Google calendar list', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('fake-refresh-valid', TEST_KEY),
    } as never);
    const out = await svc.listCalendars('tutor_a');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.items).toHaveLength(2);
      expect(out.items[0]?.summary).toBe('Lessons');
    }
  });

  it('maps invalid_grant to disconnected + clears the row + audits', async () => {
    const { svc, prisma, audit, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
    } as never);
    vi.spyOn(fake, 'listCalendars').mockRejectedValue(new GoogleInvalidGrantError());
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);

    expect(await svc.listCalendars('tutor_a')).toEqual({ ok: false, error: 'disconnected' });
    expect(vi.mocked(prisma.tutor.update).mock.calls[0]?.[0].data.googleRefreshToken).toBeNull();
    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.google.invalidated' }),
    );
  });

  it('maps quota errors to quota_exceeded (no row mutation)', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
    } as never);
    vi.spyOn(fake, 'listCalendars').mockRejectedValue(new GoogleQuotaError());
    expect(await svc.listCalendars('tutor_a')).toEqual({ ok: false, error: 'quota_exceeded' });
    expect(vi.mocked(prisma.tutor.update)).not.toHaveBeenCalled();
  });

  it('maps 5xx unavailable to unavailable', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
    } as never);
    vi.spyOn(fake, 'listCalendars').mockRejectedValue(new GoogleUnavailableError());
    expect(await svc.listCalendars('tutor_a')).toEqual({ ok: false, error: 'unavailable' });
  });

  it('treats undecryptable blob as disconnected + invalidates row', async () => {
    const { svc, prisma, audit } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      // ciphertext encrypted with a different key.
      googleRefreshToken: encryptToken('rt-xyz', '1'.repeat(64)),
    } as never);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    expect(await svc.listCalendars('tutor_a')).toEqual({ ok: false, error: 'disconnected' });
    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.google.invalidated' }),
    );
  });
});

describe('GoogleIntegrationService.listEventsForTutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disconnected when no refresh token', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: null,
      lessonCalendarIds: [],
    } as never);
    expect(
      await svc.listEventsForTutor({
        tutorId: 'tutor_a',
        from: new Date(0),
        to: new Date(10),
      }),
    ).toEqual({ ok: false, error: 'disconnected' });
  });

  it('returns empty events when no calendars selected', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('fake-refresh-valid', TEST_KEY),
      lessonCalendarIds: [],
    } as never);
    expect(
      await svc.listEventsForTutor({
        tutorId: 'tutor_a',
        from: new Date(0),
        to: new Date(10),
      }),
    ).toEqual({ ok: true, events: [] });
  });

  it('forwards refresh + calendar ids to Google and returns events', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('fake-refresh-valid', TEST_KEY),
      lessonCalendarIds: ['cal-primary'],
    } as never);
    const spy = vi.spyOn(fake, 'listEvents');
    const from = new Date(Date.now() - 7 * 86_400_000);
    const to = new Date(Date.now() + 7 * 86_400_000);
    const out = await svc.listEventsForTutor({ tutorId: 'tutor_a', from, to });
    expect(spy).toHaveBeenCalledWith({
      refreshToken: 'fake-refresh-valid',
      calendarIds: ['cal-primary'],
      from,
      to,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.events.length).toBeGreaterThan(0);
  });

  it('maps invalid_grant on events to disconnected + clears row', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
      lessonCalendarIds: ['cal-primary'],
    } as never);
    vi.spyOn(fake, 'listEvents').mockRejectedValue(new GoogleInvalidGrantError());
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    expect(
      await svc.listEventsForTutor({
        tutorId: 'tutor_a',
        from: new Date(0),
        to: new Date(10),
      }),
    ).toEqual({ ok: false, error: 'disconnected' });
    expect(vi.mocked(prisma.tutor.update).mock.calls[0]?.[0].data.googleRefreshToken).toBeNull();
  });

  it('maps quota errors', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
      lessonCalendarIds: ['cal-primary'],
    } as never);
    vi.spyOn(fake, 'listEvents').mockRejectedValue(new GoogleQuotaError());
    expect(
      await svc.listEventsForTutor({
        tutorId: 'tutor_a',
        from: new Date(0),
        to: new Date(10),
      }),
    ).toEqual({ ok: false, error: 'quota_exceeded' });
  });

  it('maps unavailable errors', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', TEST_KEY),
      lessonCalendarIds: ['cal-primary'],
    } as never);
    vi.spyOn(fake, 'listEvents').mockRejectedValue(new GoogleUnavailableError());
    expect(
      await svc.listEventsForTutor({
        tutorId: 'tutor_a',
        from: new Date(0),
        to: new Date(10),
      }),
    ).toEqual({ ok: false, error: 'unavailable' });
  });

  it('treats undecryptable blob as disconnected during events fetch', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('rt-xyz', '1'.repeat(64)),
      lessonCalendarIds: ['cal-primary'],
    } as never);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    expect(
      await svc.listEventsForTutor({
        tutorId: 'tutor_a',
        from: new Date(0),
        to: new Date(10),
      }),
    ).toEqual({ ok: false, error: 'disconnected' });
  });

  it('rethrows unexpected errors instead of swallowing', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('fake-refresh-valid', TEST_KEY),
      lessonCalendarIds: ['cal-primary'],
    } as never);
    vi.spyOn(fake, 'listEvents').mockRejectedValue(new Error('weird db hiccup'));
    await expect(
      svc.listEventsForTutor({ tutorId: 'tutor_a', from: new Date(0), to: new Date(10) }),
    ).rejects.toThrow(/weird/);
  });
});

describe('GoogleIntegrationService.listCalendars unexpected error', () => {
  it('rethrows unmapped errors from the Google client', async () => {
    const { svc, prisma, fake } = makeService();
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: encryptToken('fake-refresh-valid', TEST_KEY),
    } as never);
    vi.spyOn(fake, 'listCalendars').mockRejectedValue(new Error('something else'));
    await expect(svc.listCalendars('tutor_a')).rejects.toThrow(/something else/);
  });
});

describe('GoogleIntegrationService.setLessonCalendarIds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces the array and audits a count', async () => {
    const { svc, prisma, audit } = makeService();
    vi.mocked(prisma.tutor.update).mockResolvedValue({
      lessonCalendarIds: ['cal-a', 'cal-b'],
    } as never);
    const out = await svc.setLessonCalendarIds({
      tutorId: 'tutor_a',
      calendarIds: ['cal-a', '  cal-b ', 'cal-a', ''],
    });
    // De-duped + trimmed + non-empty.
    expect(vi.mocked(prisma.tutor.update).mock.calls[0]?.[0].data.lessonCalendarIds).toEqual([
      'cal-a',
      'cal-b',
    ]);
    expect(out.lessonCalendarIds).toEqual(['cal-a', 'cal-b']);
    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.google.calendars.updated',
        metadata: { count: 2 },
      }),
    );
  });
});

describe('GoogleIntegrationService.requireKey defence', () => {
  it('throws when the integration is actively used without a key (completeConnect path)', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub({ INTEGRATION_TOKEN_ENCRYPTION_KEY: undefined });
    const audit = { record: vi.fn() } as unknown as AuditService;
    const fake = new FakeGoogleCalendarClient();
    const svc = new GoogleIntegrationService(prisma, audit, config, fake);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    // completeConnect immediately tries to encrypt → must fail loud since
    // there's nothing to fall back to.
    await expect(
      svc.completeConnect({ tutorId: 'tutor_a', code: 'code-1' }),
    ).rejects.toThrow(/INTEGRATION_TOKEN_ENCRYPTION_KEY/);
  });

  it('treats stored value as disconnected when key is missing on read path (defensive)', async () => {
    // The reverse case: we have a stored ciphertext but no key to decrypt.
    // Surface "disconnected" so the UI prompts a reconnect instead of 500ing.
    const prisma = makePrismaMock();
    const config = makeConfigStub({ INTEGRATION_TOKEN_ENCRYPTION_KEY: undefined });
    const audit = { record: vi.fn() } as unknown as AuditService;
    const fake = new FakeGoogleCalendarClient();
    const svc = new GoogleIntegrationService(prisma, audit, config, fake);
    vi.mocked(prisma.tutor.findUnique).mockResolvedValue({
      googleRefreshToken: 'whatever-ciphertext',
    } as never);
    vi.mocked(prisma.tutor.update).mockResolvedValue({} as never);
    expect(await svc.listCalendars('tutor_a')).toEqual({ ok: false, error: 'disconnected' });
  });
});
