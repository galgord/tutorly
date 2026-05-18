import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../test/prisma-mock';
import { AuthGuard } from './auth.guard';
import { SESSION_COOKIE_NAME } from './cookie';
import type { SessionService } from './session.service';

function ctx(sessionToken: string | undefined): ExecutionContext {
  const req: Record<string, unknown> = {
    cookies: sessionToken ? { [SESSION_COOKIE_NAME]: sessionToken } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  sessionResolves?: { tutorId: string } | null;
  tutor?: { id: string; email: string; name: string | null; locale: string; deletedAt: Date | null } | null;
}) {
  const sessions = {
    resolve: vi.fn().mockResolvedValue(opts.sessionResolves ?? null),
  } as unknown as SessionService;
  const prisma = makePrismaMock();
  vi.mocked(prisma.tutor.findUnique).mockResolvedValue(opts.tutor as never);
  return new AuthGuard(sessions, prisma);
}

describe('AuthGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when no session cookie', async () => {
    const guard = makeGuard({ sessionResolves: null });
    await expect(guard.canActivate(ctx(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when session resolves to null', async () => {
    const guard = makeGuard({ sessionResolves: null });
    await expect(guard.canActivate(ctx('raw'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when tutor not found in DB', async () => {
    const guard = makeGuard({ sessionResolves: { tutorId: 't1' }, tutor: null });
    await expect(guard.canActivate(ctx('raw'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when tutor is soft-deleted', async () => {
    const guard = makeGuard({
      sessionResolves: { tutorId: 't1' },
      tutor: {
        id: 't1',
        email: 'a@b.co',
        name: null,
        locale: 'en',
        deletedAt: new Date(),
      },
    });
    await expect(guard.canActivate(ctx('raw'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches tutor to request and returns true on success', async () => {
    const guard = makeGuard({
      sessionResolves: { tutorId: 't1' },
      tutor: { id: 't1', email: 'a@b.co', name: 'Sara', locale: 'he', deletedAt: null },
    });
    const context = ctx('raw');
    expect(await guard.canActivate(context)).toBe(true);
    const req = context.switchToHttp().getRequest() as { tutor?: { id: string } };
    expect(req.tutor).toEqual({ id: 't1', email: 'a@b.co', name: 'Sara', locale: 'he' });
  });
});
