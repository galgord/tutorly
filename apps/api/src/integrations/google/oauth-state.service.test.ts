import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePrismaMock } from '../../test/prisma-mock';
import { OAuthStateService } from './oauth-state.service';

function makeService() {
  const prisma = makePrismaMock();
  const svc = new OAuthStateService(prisma);
  return { svc, prisma };
}

describe('OAuthStateService.issue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a fresh 256-bit state row scoped to the tutor', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.create).mockResolvedValue({} as never);
    const state = await svc.issue({ tutorId: 'tutor_a' });
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43-char base64url

    const args = vi.mocked(prisma.oAuthState.create).mock.calls[0]?.[0];
    expect(args?.data.tutorId).toBe('tutor_a');
    expect(args?.data.provider).toBe('google');
    expect(args?.data.expiresAt).toBeInstanceOf(Date);
    // Default 10 minutes ahead.
    const ms = (args?.data.expiresAt as Date).getTime() - Date.now();
    expect(ms).toBeGreaterThan(9 * 60_000);
    expect(ms).toBeLessThanOrEqual(10 * 60_000 + 100);
  });

  it('respects an explicit provider', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.create).mockResolvedValue({} as never);
    await svc.issue({ tutorId: 'tutor_a', provider: 'other' });
    expect(vi.mocked(prisma.oAuthState.create).mock.calls[0]?.[0].data.provider).toBe('other');
  });
});

describe('OAuthStateService.consume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing state', async () => {
    const { svc } = makeService();
    await expect(svc.consume({ state: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown state', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue(null);
    await expect(svc.consume({ state: 'x' })).rejects.toThrow(/Invalid/);
  });

  it('rejects expired state', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'x',
      tutorId: 't1',
      provider: 'google',
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    } as never);
    await expect(svc.consume({ state: 'x' })).rejects.toThrow(/expired/);
  });

  it('rejects already-consumed state', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'x',
      tutorId: 't1',
      provider: 'google',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    } as never);
    await expect(svc.consume({ state: 'x' })).rejects.toThrow(/used/);
  });

  it('rejects state issued for a different provider', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'x',
      tutorId: 't1',
      provider: 'apple',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    await expect(svc.consume({ state: 'x' })).rejects.toThrow(/different provider/);
  });

  it('returns tutorId on a valid state and marks consumed', async () => {
    const { svc, prisma } = makeService();
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'x',
      tutorId: 't1',
      provider: 'google',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    vi.mocked(prisma.oAuthState.update).mockResolvedValue({} as never);
    const { tutorId } = await svc.consume({ state: 'x' });
    expect(tutorId).toBe('t1');
    expect(vi.mocked(prisma.oAuthState.update).mock.calls[0]?.[0].data.consumedAt).toBeInstanceOf(Date);
  });
});
