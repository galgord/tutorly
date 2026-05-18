import { describe, expect, it } from 'vitest';
import { constantTimeEqual, generateToken, hashToken } from './token.util';

describe('token utils', () => {
  it('generateToken produces 43-char base64url tokens (32 bytes)', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generateToken returns distinct values', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(set.size).toBe(100);
  });

  it('hashToken is deterministic and changes with secret', () => {
    const h1 = hashToken('foo', 'secret-a-long-enough-to-satisfy-zod-xx');
    const h2 = hashToken('foo', 'secret-a-long-enough-to-satisfy-zod-xx');
    const h3 = hashToken('foo', 'secret-b-long-enough-to-satisfy-zod-xx');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('constantTimeEqual returns true for equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });

  it('constantTimeEqual returns false for different strings', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('constantTimeEqual returns false for different lengths (no throw)', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
