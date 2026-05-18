import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../config/config.service';
import { makeConfigStub } from '../test/fixtures';
import { AuthController } from './auth.controller';
import { SESSION_COOKIE_NAME } from './cookie';
import type { MagicLinkService } from './magic-link.service';
import type { SessionService } from './session.service';

interface FakeRes {
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function fakeReq(opts: { ip?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}): Request {
  const headers = opts.headers ?? {};
  return {
    ip: opts.ip,
    cookies: opts.cookies ?? {},
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function fakeRes(): FakeRes {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
    send: vi.fn(),
  };
}

function makeController(
  magicLinkOverrides: Partial<MagicLinkService> = {},
  sessionsOverrides: Partial<SessionService> = {},
  config: ConfigService = makeConfigStub(),
) {
  const magicLink = {
    issue: vi.fn().mockResolvedValue({ url: 'http://localhost:3000/auth/consume?token=raw' }),
    consume: vi.fn().mockResolvedValue({ tutorId: 'tutor_1' }),
    ...magicLinkOverrides,
  } as unknown as MagicLinkService;

  const sessions = {
    issue: vi
      .fn()
      .mockResolvedValue({ rawToken: 'sess-raw', expiresAt: new Date(Date.now() + 60_000) }),
    resolve: vi.fn().mockResolvedValue({ tutorId: 'tutor_1' }),
    revoke: vi.fn().mockResolvedValue(undefined),
    ...sessionsOverrides,
  } as unknown as SessionService;

  return { controller: new AuthController(magicLink, sessions, config), magicLink, sessions };
}

describe('AuthController.requestLink', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts valid email and calls MagicLinkService.issue (non-prod includes devMagicLinkUrl)', async () => {
    const { controller, magicLink } = makeController();
    const res = await controller.requestLink({ email: 'sara@example.com' }, fakeReq({ ip: '1.2.3.4' }));
    expect(res).toMatchObject({ ok: true });
    // In non-prod the response includes the consume URL so dev/tests don't scrape logs.
    expect((res as { devMagicLinkUrl?: string }).devMagicLinkUrl).toMatch(/^http:\/\/.*\/auth\/consume\?token=/);
    expect(magicLink.issue).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'sara@example.com', ipAddress: '1.2.3.4' }),
    );
  });

  it('omits devMagicLinkUrl in production', async () => {
    const prodConfig = makeConfigStub({ NODE_ENV: 'production' });
    const { controller } = makeController({}, {}, prodConfig);
    const res = await controller.requestLink({ email: 'sara@example.com' }, fakeReq());
    expect(res).toEqual({ ok: true });
  });

  it('rejects invalid email with 400', async () => {
    const { controller } = makeController();
    await expect(controller.requestLink({ email: 'not-an-email' }, fakeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('prefers x-forwarded-for over req.ip', async () => {
    const { controller, magicLink } = makeController();
    await controller.requestLink(
      { email: 'a@b.co' },
      fakeReq({ ip: '5.5.5.5', headers: { 'x-forwarded-for': '8.8.8.8, 9.9.9.9' } }),
    );
    expect(magicLink.issue).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: '8.8.8.8' }));
  });
});

describe('AuthController.consume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing token', async () => {
    const { controller } = makeController();
    await expect(controller.consume(undefined, fakeReq(), fakeRes() as unknown as Response)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('issues session cookies and redirects to WEB_ORIGIN/dashboard', async () => {
    const { controller, magicLink, sessions } = makeController();
    const res = fakeRes();
    await controller.consume('raw-token', fakeReq(), res as unknown as Response);

    expect(magicLink.consume).toHaveBeenCalledWith(expect.objectContaining({ rawToken: 'raw-token' }));
    expect(sessions.issue).toHaveBeenCalledWith(expect.objectContaining({ tutorId: 'tutor_1' }));

    const cookieCalls = res.cookie.mock.calls.map((c) => c[0]);
    expect(cookieCalls).toContain('tutor_session');
    expect(cookieCalls).toContain('tutor_csrf');

    expect(res.redirect).toHaveBeenCalledWith(302, 'http://localhost:5174/dashboard');
  });

  it('sets secure cookies in prod', async () => {
    const prodConfig = makeConfigStub({ NODE_ENV: 'production' });
    const { controller } = makeController({}, {}, prodConfig);
    const res = fakeRes();
    await controller.consume('raw-token', fakeReq(), res as unknown as Response);
    const sessionCookieOpts = res.cookie.mock.calls.find((c) => c[0] === 'tutor_session')?.[2];
    expect(sessionCookieOpts.secure).toBe(true);
  });
});

describe('AuthController.logout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes session and clears cookies', async () => {
    const { controller, sessions } = makeController();
    const res = fakeRes();
    const req = {
      ...fakeReq({ cookies: { [SESSION_COOKIE_NAME]: 'raw-sess' } }),
      tutor: { id: 'tutor_1', email: 'a@b.co', name: null, locale: 'en' },
    } as unknown as Request;
    await controller.logout(req as never, res as unknown as Response);
    expect(sessions.revoke).toHaveBeenCalledWith('raw-sess');
    expect(res.clearCookie).toHaveBeenCalledWith('tutor_session', expect.anything());
    expect(res.clearCookie).toHaveBeenCalledWith('tutor_csrf', expect.anything());
    expect(res.send).toHaveBeenCalled();
  });

  it('tolerates logout when cookie is missing', async () => {
    const { controller, sessions } = makeController();
    const res = fakeRes();
    const req = { ...fakeReq(), tutor: { id: 't1' } } as unknown as Request;
    await controller.logout(req as never, res as unknown as Response);
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });
});
