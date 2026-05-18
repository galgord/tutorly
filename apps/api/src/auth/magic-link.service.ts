import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateToken, hashToken } from './token.util';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const EMAIL_MAX_LEN = 254;
const PER_EMAIL_RATE_LIMIT = 3;
const PER_EMAIL_RATE_WINDOW_MS = 60 * 1000;

interface IssueOptions {
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface IssueResult {
  /** The raw token URL — only returned for testing/local dev where the caller logs it. */
  url: string;
}

@Injectable()
export class MagicLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issues a magic link and emails it. Always behaves the same regardless of
   * whether the email maps to an existing tutor (constant-time-ish, no
   * account-existence leak).
   */
  async issue(opts: IssueOptions): Promise<IssueResult> {
    const email = this.normalizeEmail(opts.email);

    // Per-email rate limit: refuse if 3+ links issued in the last minute.
    // Done in Postgres so it survives restarts and works across api instances.
    const recentCount = await this.prisma.magicLink.count({
      where: {
        email,
        createdAt: { gte: new Date(Date.now() - PER_EMAIL_RATE_WINDOW_MS) },
      },
    });
    if (recentCount >= PER_EMAIL_RATE_LIMIT) {
      throw new HttpException(
        'Too many requests for this email. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const raw = generateToken();
    const hashed = hashToken(raw, this.config.get('SESSION_COOKIE_SECRET'));
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.magicLink.create({
      data: {
        token: hashed,
        email,
        expiresAt,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });

    const tutor = await this.prisma.tutor.findUnique({
      where: { email },
      select: { id: true, locale: true },
    });

    const url = this.buildLink(raw);
    await this.mailer.sendMagicLink({
      to: email,
      url,
      locale: (tutor?.locale as 'en' | 'pt' | 'he') ?? 'en',
    });

    await this.audit.record({
      tutorId: tutor?.id ?? null,
      actorType: ActorType.SYSTEM,
      action: 'auth.magic_link.issued',
      entityType: 'MagicLink',
      metadata: { email_hash: hashEmail(email) },
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    });

    return { url };
  }

  /**
   * Consumes a token — marks it used, returns the email it was issued for,
   * and creates/returns the Tutor (auto-provisioning on first sign-in).
   */
  async consume(opts: {
    rawToken: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ tutorId: string }> {
    const hashed = hashToken(opts.rawToken, this.config.get('SESSION_COOKIE_SECRET'));

    const link = await this.prisma.magicLink.findUnique({ where: { token: hashed } });
    if (!link) throw new BadRequestException('Invalid or expired link.');
    if (link.consumedAt) throw new BadRequestException('Link already used.');
    if (link.expiresAt.getTime() < Date.now()) throw new BadRequestException('Link expired.');

    const tutor = await this.prisma.tutor.upsert({
      where: { email: link.email },
      update: {},
      create: { email: link.email },
    });

    await this.prisma.magicLink.update({
      where: { token: hashed },
      data: { consumedAt: new Date() },
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'auth.magic_link.consumed',
      entityType: 'Tutor',
      entityId: tutor.id,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    });

    return { tutorId: tutor.id };
  }

  private buildLink(rawToken: string): string {
    const base = this.config.get('PUBLIC_API_BASE_URL').replace(/\/+$/, '');
    return `${base}/auth/consume?token=${encodeURIComponent(rawToken)}`;
  }

  private normalizeEmail(email: string): string {
    const trimmed = email.trim().toLowerCase();
    if (trimmed.length === 0 || trimmed.length > EMAIL_MAX_LEN || !trimmed.includes('@')) {
      throw new BadRequestException('Invalid email.');
    }
    return trimmed;
  }
}

function hashEmail(email: string): string {
  // Lightweight one-way fingerprint so audit metadata doesn't store raw PII.
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}
