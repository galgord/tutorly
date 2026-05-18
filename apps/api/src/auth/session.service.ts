import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateToken, hashToken } from './token.util';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface IssueOptions {
  tutorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issue(opts: IssueOptions): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = generateToken();
    const hashed = hashToken(rawToken, this.config.get('SESSION_COOKIE_SECRET'));
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        token: hashed,
        tutorId: opts.tutorId,
        expiresAt,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });

    return { rawToken, expiresAt };
  }

  async resolve(rawToken: string): Promise<{ tutorId: string } | null> {
    const hashed = hashToken(rawToken, this.config.get('SESSION_COOKIE_SECRET'));
    const session = await this.prisma.session.findUnique({
      where: { token: hashed },
      select: { tutorId: true, expiresAt: true },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.session.delete({ where: { token: hashed } }).catch(() => undefined);
      return null;
    }
    return { tutorId: session.tutorId };
  }

  async revoke(rawToken: string): Promise<void> {
    const hashed = hashToken(rawToken, this.config.get('SESSION_COOKIE_SECRET'));
    await this.prisma.session.delete({ where: { token: hashed } }).catch(() => undefined);
  }

  async revokeAllForTutor(tutorId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tutorId } });
  }
}
