import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes → 43-char URL-safe base64 (no padding). 256 bits of entropy. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time string compare, returns false for length mismatches. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Storage hash for a token — never store raw tokens. HMAC-SHA256 with the
 * session secret so an attacker with DB read-only access cannot forge sessions
 * without also stealing the secret.
 */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
