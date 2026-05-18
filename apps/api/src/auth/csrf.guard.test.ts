import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './cookie';
import { CsrfGuard } from './csrf.guard';

function ctx(method: string, cookie: string | undefined, header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        cookies: cookie ? { [CSRF_COOKIE_NAME]: cookie } : {},
        header: (name: string) =>
          name.toLowerCase() === CSRF_HEADER_NAME ? header : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it.each(['GET', 'HEAD', 'OPTIONS'])('skips check for safe method %s', (m) => {
    expect(guard.canActivate(ctx(m, undefined, undefined))).toBe(true);
  });

  it('rejects POST with no cookie', () => {
    expect(() => guard.canActivate(ctx('POST', undefined, 'abc'))).toThrow(ForbiddenException);
  });

  it('rejects POST with no header', () => {
    expect(() => guard.canActivate(ctx('POST', 'abc', undefined))).toThrow(ForbiddenException);
  });

  it('rejects POST with cookie/header mismatch', () => {
    expect(() => guard.canActivate(ctx('POST', 'abc', 'def'))).toThrow(ForbiddenException);
  });

  it('accepts POST with matching double-submit token', () => {
    expect(guard.canActivate(ctx('POST', 'token-xyz', 'token-xyz'))).toBe(true);
  });

  it('rejects POST when header length differs (constant-time)', () => {
    expect(() => guard.canActivate(ctx('POST', 'short', 'short-longer'))).toThrow(ForbiddenException);
  });
});
