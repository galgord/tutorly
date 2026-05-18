import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { MagicLinkRequestSchema, MagicLinkResponseSchema } from '@tutor-app/shared';
import type { Request, Response } from 'express';
import { ConfigService } from '../config/config.service';
import { AuthGuard, type AuthedRequest } from './auth.guard';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedCookieOptions,
  csrfCookieOptions,
  sessionCookieOptions,
} from './cookie';
import { MagicLinkService } from './magic-link.service';
import { SessionService } from './session.service';
import { generateToken } from './token.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly magicLink: MagicLinkService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Post('magic-link')
  @HttpCode(202)
  async requestLink(@Body() body: unknown, @Req() req: Request) {
    const parsed = MagicLinkRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const { url } = await this.magicLink.issue({
      email: parsed.data.email,
      ipAddress: this.clientIp(req),
      userAgent: req.header('user-agent'),
    });
    // Always 202 regardless of whether the account exists (no enumeration).
    // In dev/test, also return the consume URL so Playwright / curl can drive
    // the flow without scraping logs. Stripped in prod.
    const response = MagicLinkResponseSchema.parse({ ok: true });
    if (!this.config.isProd()) {
      return { ...response, devMagicLinkUrl: url };
    }
    return response;
  }

  @Get('consume')
  async consume(@Query('token') token: string | undefined, @Req() req: Request, @Res() res: Response) {
    if (!token) throw new BadRequestException('Missing token.');

    const { tutorId } = await this.magicLink.consume({
      rawToken: token,
      ipAddress: this.clientIp(req),
      userAgent: req.header('user-agent'),
    });
    const { rawToken: sessionToken, expiresAt } = await this.sessions.issue({
      tutorId,
      ipAddress: this.clientIp(req),
      userAgent: req.header('user-agent'),
    });
    const csrf = generateToken();

    const isProd = this.config.isProd();
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(isProd, expiresAt));
    res.cookie(CSRF_COOKIE_NAME, csrf, csrfCookieOptions(isProd, expiresAt));

    res.redirect(302, `${this.config.get('WEB_ORIGIN')}/dashboard`);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthedRequest, @Res() res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    if (token) await this.sessions.revoke(token);

    const isProd = this.config.isProd();
    res.clearCookie(SESSION_COOKIE_NAME, clearedCookieOptions(isProd));
    res.clearCookie(CSRF_COOKIE_NAME, { ...clearedCookieOptions(isProd), httpOnly: false });
    res.send();
  }

  private clientIp(req: Request): string | null {
    const fwd = req.header('x-forwarded-for');
    if (fwd) return fwd.split(',')[0]?.trim() ?? null;
    return req.ip ?? null;
  }
}
