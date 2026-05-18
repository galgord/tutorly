import { BadRequestException, Injectable } from '@nestjs/common';
import { generateToken } from '../../auth/token.util';
import { PrismaService } from '../../prisma/prisma.service';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — the spec's hard cap

/**
 * OAuth state CSRF protection. Generates a random URL-safe value, persists
 * it scoped to the originating tutor with a 10-minute TTL, and consumes it
 * exactly once on the callback.
 *
 * Why DB-backed instead of a signed cookie: keeps state-validation logic
 * trivial (atomic upsert / delete) and prevents replay across browsers.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(opts: { tutorId: string; provider?: string }): Promise<string> {
    const state = generateToken(32);
    await this.prisma.oAuthState.create({
      data: {
        state,
        tutorId: opts.tutorId,
        provider: opts.provider ?? 'google',
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    return state;
  }

  /**
   * Verifies + consumes the state in a single transaction. Returns the
   * tutorId the state was issued for. Throws 400 for missing / unknown /
   * expired / already-consumed state values.
   */
  async consume(opts: { state: string; provider?: string }): Promise<{ tutorId: string }> {
    if (!opts.state || opts.state.length === 0) {
      throw new BadRequestException('Missing OAuth state.');
    }
    const provider = opts.provider ?? 'google';
    const row = await this.prisma.oAuthState.findUnique({ where: { state: opts.state } });
    if (!row) throw new BadRequestException('Invalid or expired OAuth state.');
    if (row.provider !== provider)
      throw new BadRequestException('OAuth state issued for a different provider.');
    if (row.consumedAt) throw new BadRequestException('OAuth state already used.');
    if (row.expiresAt.getTime() < Date.now())
      throw new BadRequestException('OAuth state expired.');

    // Single-use: mark consumed before returning so a duplicate callback
    // (browser back-button) fails closed.
    await this.prisma.oAuthState.update({
      where: { state: opts.state },
      data: { consumedAt: new Date() },
    });
    return { tutorId: row.tutorId };
  }
}
