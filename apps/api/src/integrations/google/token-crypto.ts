import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ChaCha20-Poly1305 AEAD parameters (RFC 8439):
//   - 32-byte key
//   - 12-byte nonce (IV)
//   - 16-byte auth tag
//
// Storage format: `${iv}.${ciphertext}.${authTag}` with each component
// base64-encoded (no padding). The dot separator is safe because base64
// never contains it.
const IV_LEN = 12;
const KEY_LEN = 32;
const TAG_LEN = 16;

export interface EncryptedToken {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

function keyFromHex(hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error('Encryption key must be 64 hex chars (32 bytes).');
  }
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== KEY_LEN) {
    throw new Error(`Encryption key must decode to ${KEY_LEN} bytes.`);
  }
  return buf;
}

/**
 * Encrypts a token (e.g. Google refresh token) with chacha20-poly1305.
 * The IV is randomly generated for each encryption — calling twice on the
 * same plaintext yields different ciphertexts.
 */
export function encryptToken(plaintext: string, hexKey: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptToken: plaintext must be a non-empty string.');
  }
  const key = keyFromHex(hexKey);
  const iv = randomBytes(IV_LEN);
  // Node typings for chacha20-poly1305 require the auth-tag length explicitly.
  const cipher = createCipheriv('chacha20-poly1305', key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), ct.toString('base64'), tag.toString('base64')].join('.');
}

/**
 * Decrypts a token previously emitted by `encryptToken`. Throws if the
 * format is wrong, the auth tag is invalid, or the key is wrong — the
 * caller should treat any error as "stored token is unusable" and force a
 * reconnect.
 */
export function decryptToken(packed: string, hexKey: string): string {
  if (typeof packed !== 'string' || packed.length === 0) {
    throw new Error('decryptToken: input must be a non-empty string.');
  }
  const parts = packed.split('.');
  if (parts.length !== 3) {
    throw new Error('decryptToken: malformed input (expected iv.ciphertext.tag).');
  }
  const [ivB64, ctB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_LEN) throw new Error('decryptToken: bad iv length.');
  if (tag.length !== TAG_LEN) throw new Error('decryptToken: bad tag length.');

  const key = keyFromHex(hexKey);
  const decipher = createDecipheriv('chacha20-poly1305', key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  // .final() throws on auth failure → caller catches and disconnects.
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Convenience: random 32-byte hex key, for test setup or rotation. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LEN).toString('hex');
}
