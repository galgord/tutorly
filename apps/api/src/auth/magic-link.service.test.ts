import { BadRequestException, HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../mailer/mailer.service';
import { makeConfigStub } from '../test/fixtures';
import { makePrismaMock } from '../test/prisma-mock';
import { MagicLinkService } from './magic-link.service';
import { hashToken } from './token.util';

function makeService(overrides: Partial<{ recentCount: number; tutor: { id: string; locale: string } | null }> = {}) {
  const prisma = makePrismaMock();
  const config = makeConfigStub();
  const mailer = { sendMagicLink: vi.fn().mockResolvedValue(undefined) } as unknown as MailerService;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  vi.mocked(prisma.magicLink.count).mockResolvedValue(overrides.recentCount ?? 0);
  vi.mocked(prisma.magicLink.create).mockResolvedValue({} as never);
  vi.mocked(prisma.tutor.findUnique).mockResolvedValue(overrides.tutor as never);

  const service = new MagicLinkService(prisma, mailer, audit, config);
  return { service, prisma, mailer, audit, config };
}

describe('MagicLinkService.issue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects malformed emails', async () => {
    const { service } = makeService();
    await expect(service.issue({ email: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.issue({ email: 'no-at-sign' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes email (trim + lowercase)', async () => {
    const { service, prisma } = makeService();
    await service.issue({ email: '  Sara@Example.COM  ' });
    expect(vi.mocked(prisma.magicLink.create).mock.calls[0]?.[0].data.email).toBe('sara@example.com');
  });

  it('creates a hashed token (never stores raw)', async () => {
    const { service, prisma, config } = makeService();
    const { url } = await service.issue({ email: 'a@b.co' });
    const rawToken = new URL(url).searchParams.get('token')!;
    const stored = vi.mocked(prisma.magicLink.create).mock.calls[0]?.[0].data.token as string;
    expect(stored).not.toBe(rawToken);
    expect(stored).toBe(hashToken(rawToken, config.get('SESSION_COOKIE_SECRET')));
  });

  it('sends mail with consume URL pointing at PUBLIC_API_BASE_URL', async () => {
    const { service, mailer } = makeService();
    await service.issue({ email: 'a@b.co' });
    const sent = vi.mocked(mailer.sendMagicLink).mock.calls[0]?.[0];
    expect(sent?.url).toMatch(/^http:\/\/localhost:3000\/auth\/consume\?token=/);
  });

  it('records an audit log entry', async () => {
    const { service, audit } = makeService();
    await service.issue({ email: 'a@b.co', ipAddress: '1.2.3.4', userAgent: 'curl' });
    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.magic_link.issued', ipAddress: '1.2.3.4' }),
    );
  });

  it('throws 429 when 3 links already issued in the last minute', async () => {
    const { service } = makeService({ recentCount: 3 });
    await expect(service.issue({ email: 'a@b.co' })).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });
    try {
      const { service: s2 } = makeService({ recentCount: 3 });
      await s2.issue({ email: 'a@b.co' });
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('does not leak account existence in mailer locale (defaults to en when no tutor)', async () => {
    const { service, mailer } = makeService({ tutor: null });
    await service.issue({ email: 'unknown@example.com' });
    expect(vi.mocked(mailer.sendMagicLink).mock.calls[0]?.[0].locale).toBe('en');
  });

  it('uses tutor locale when account exists', async () => {
    const { service, mailer } = makeService({ tutor: { id: 't1', locale: 'he' } });
    await service.issue({ email: 'sara@example.com' });
    expect(vi.mocked(mailer.sendMagicLink).mock.calls[0]?.[0].locale).toBe('he');
  });
});

describe('MagicLinkService.consume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unknown token', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.magicLink.findUnique).mockResolvedValue(null);
    await expect(service.consume({ rawToken: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired token', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.magicLink.findUnique).mockResolvedValue({
      token: 'h',
      email: 'a@b.co',
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    } as never);
    await expect(service.consume({ rawToken: 'abc' })).rejects.toThrow(/expired/);
  });

  it('rejects an already-used token', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.magicLink.findUnique).mockResolvedValue({
      token: 'h',
      email: 'a@b.co',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    } as never);
    await expect(service.consume({ rawToken: 'abc' })).rejects.toThrow(/used/);
  });

  it('marks the link consumed + upserts tutor + audits on success', async () => {
    const { service, prisma, audit } = makeService();
    vi.mocked(prisma.magicLink.findUnique).mockResolvedValue({
      token: 'h',
      email: 'sara@example.com',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    vi.mocked(prisma.tutor.upsert).mockResolvedValue({ id: 'tutor_1', email: 'sara@example.com' } as never);
    vi.mocked(prisma.magicLink.update).mockResolvedValue({} as never);

    const result = await service.consume({ rawToken: 'abc', ipAddress: '1.1.1.1' });
    expect(result).toEqual({ tutorId: 'tutor_1' });
    expect(vi.mocked(prisma.tutor.upsert)).toHaveBeenCalled();
    expect(vi.mocked(prisma.magicLink.update).mock.calls[0]?.[0].data.consumedAt).toBeInstanceOf(Date);
    expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.magic_link.consumed', tutorId: 'tutor_1' }),
    );
  });
});
