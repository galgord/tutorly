import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'tutor_session';
export const CSRF_COOKIE_NAME = 'tutor_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function sessionCookieOptions(isProd: boolean, expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  };
}

export function csrfCookieOptions(isProd: boolean, expiresAt: Date): CookieOptions {
  return {
    httpOnly: false, // Readable by web so it can echo in header (double-submit pattern).
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  };
}

export function clearedCookieOptions(isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  };
}
