import { describe, expect, it } from 'vitest';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  clearedCookieOptions,
  csrfCookieOptions,
  sessionCookieOptions,
} from './cookie';

describe('cookie options', () => {
  const future = new Date(Date.now() + 60_000);

  it('exposes stable cookie/header names', () => {
    expect(SESSION_COOKIE_NAME).toBe('tutor_session');
    expect(CSRF_COOKIE_NAME).toBe('tutor_csrf');
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
  });

  it('sessionCookieOptions is HttpOnly + SameSite=lax + secure in prod only', () => {
    const dev = sessionCookieOptions(false, future);
    const prod = sessionCookieOptions(true, future);
    expect(dev.httpOnly).toBe(true);
    expect(dev.sameSite).toBe('lax');
    expect(dev.secure).toBe(false);
    expect(prod.secure).toBe(true);
    expect(dev.expires).toEqual(future);
  });

  it('csrfCookieOptions is non-HttpOnly (readable by client)', () => {
    const opts = csrfCookieOptions(true, future);
    expect(opts.httpOnly).toBe(false);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('lax');
  });

  it('clearedCookieOptions expires in 1970', () => {
    const opts = clearedCookieOptions(true);
    expect(opts.expires?.getTime()).toBe(0);
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
  });
});
