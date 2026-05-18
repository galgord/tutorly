import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, generateEncryptionKey } from './token-crypto';

describe('token-crypto', () => {
  const key = generateEncryptionKey();

  it('round-trips a sample token', () => {
    const plaintext = '1//0gExampleRefreshToken-with-some-payload';
    const packed = encryptToken(plaintext, key);
    expect(packed).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(decryptToken(packed, key)).toBe(plaintext);
  });

  it('produces non-deterministic ciphertexts (different IV each encrypt)', () => {
    const plaintext = 'same-input-twice';
    const a = encryptToken(plaintext, key);
    const b = encryptToken(plaintext, key);
    expect(a).not.toBe(b);
    // But both decrypt back to the same plaintext.
    expect(decryptToken(a, key)).toBe(plaintext);
    expect(decryptToken(b, key)).toBe(plaintext);
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const packed = encryptToken('hello', key);
    const [iv, ct, tag] = packed.split('.');
    // Flip a bit in the ciphertext segment.
    const tampered = Buffer.from(ct!, 'base64');
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    const corrupted = [iv, tampered.toString('base64'), tag].join('.');
    expect(() => decryptToken(corrupted, key)).toThrow();
  });

  it('rejects tampered auth tag', () => {
    const packed = encryptToken('hello', key);
    const [iv, ct, tag] = packed.split('.');
    const tampered = Buffer.from(tag!, 'base64');
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    const corrupted = [iv, ct, tampered.toString('base64')].join('.');
    expect(() => decryptToken(corrupted, key)).toThrow();
  });

  it('rejects decrypt with the wrong key (auth failure)', () => {
    const wrongKey = generateEncryptionKey();
    const packed = encryptToken('hello', key);
    expect(() => decryptToken(packed, wrongKey)).toThrow();
  });

  it('rejects malformed packed input', () => {
    expect(() => decryptToken('not-three-parts', key)).toThrow();
    expect(() => decryptToken('', key)).toThrow();
    expect(() => decryptToken('a.b', key)).toThrow();
  });

  it('rejects non-hex keys at encrypt/decrypt time', () => {
    expect(() => encryptToken('x', 'not-hex')).toThrow();
    expect(() => decryptToken('a.b.c', 'not-hex')).toThrow();
  });

  it('rejects empty plaintext (avoid silently encrypting empty)', () => {
    expect(() => encryptToken('', key)).toThrow();
  });

  it('handles large tokens (10kb roundtrip)', () => {
    const big = 'x'.repeat(10_000);
    expect(decryptToken(encryptToken(big, key), key)).toBe(big);
  });

  it('handles unicode payloads', () => {
    const text = 'מורה→tutor with emoji ✨ and digits 12345';
    expect(decryptToken(encryptToken(text, key), key)).toBe(text);
  });
});
