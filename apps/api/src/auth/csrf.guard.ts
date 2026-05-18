import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './cookie';
import { constantTimeEqual } from './token.util';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF: client reads the `tutor_csrf` cookie (non-HttpOnly) and
 * echoes it in the `x-csrf-token` header on state-changing requests. Cookie
 * value is set on session creation.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const cookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE_NAME];
    const header = req.header(CSRF_HEADER_NAME);
    if (!cookie || !header || !constantTimeEqual(cookie, header)) {
      throw new ForbiddenException('CSRF token missing or mismatched.');
    }
    return true;
  }
}
