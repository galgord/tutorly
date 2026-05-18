import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfigStub } from '../test/fixtures';
import { makePrismaMock } from '../test/prisma-mock';
import { SessionService } from './session.service';
import { hashToken } from './token.util';

describe('SessionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a session and stores only the hashed token', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub();
    vi.mocked(prisma.session.create).mockResolvedValue({} as never);

    const svc = new SessionService(prisma, config);
    const { rawToken, expiresAt } = await svc.issue({ tutorId: 'tutor_1' });

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const stored = vi.mocked(prisma.session.create).mock.calls[0]?.[0].data.token as string;
    expect(stored).toBe(hashToken(rawToken, config.get('SESSION_COOKIE_SECRET')));
    expect(stored).not.toBe(rawToken);
  });

  it('resolves a valid session to a tutorId', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub();
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      tutorId: 'tutor_1',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const svc = new SessionService(prisma, config);
    const result = await svc.resolve('raw-token');
    expect(result).toEqual({ tutorId: 'tutor_1' });
  });

  it('returns null and deletes when session is expired', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub();
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      tutorId: 'tutor_1',
      expiresAt: new Date(Date.now() - 1000),
    } as never);
    vi.mocked(prisma.session.delete).mockResolvedValue({} as never);

    const svc = new SessionService(prisma, config);
    expect(await svc.resolve('raw-token')).toBeNull();
    expect(vi.mocked(prisma.session.delete)).toHaveBeenCalled();
  });

  it('returns null on unknown token', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub();
    vi.mocked(prisma.session.findUnique).mockResolvedValue(null);

    const svc = new SessionService(prisma, config);
    expect(await svc.resolve('raw')).toBeNull();
  });

  it('revoke deletes the session (swallows not-found)', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub();
    vi.mocked(prisma.session.delete).mockRejectedValue(new Error('not found'));

    const svc = new SessionService(prisma, config);
    await expect(svc.revoke('raw')).resolves.toBeUndefined();
  });

  it('revokeAllForTutor deletes all sessions for a tutor', async () => {
    const prisma = makePrismaMock();
    const config = makeConfigStub();
    vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 3 } as never);

    const svc = new SessionService(prisma, config);
    await svc.revokeAllForTutor('tutor_1');
    expect(vi.mocked(prisma.session.deleteMany)).toHaveBeenCalledWith({
      where: { tutorId: 'tutor_1' },
    });
  });
});
