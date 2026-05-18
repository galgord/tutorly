import { describe, expect, it } from 'vitest';
import { sniffAudioMime } from './audio-mime';

/**
 * Build minimal byte fixtures that pass magic-bytes for our supported
 * containers. We're not exhaustively testing every codec — magic-bytes
 * does that. We're verifying our allowlist gate.
 */

// Minimal WAV header (RIFF .... WAVE)
const WAV_FIXTURE = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // chunk size
  0x57, 0x41, 0x56, 0x45, // WAVE
  0x66, 0x6d, 0x74, 0x20, // fmt␣
  0x10, 0x00, 0x00, 0x00, // subchunk size = 16
  0x01, 0x00, 0x01, 0x00, // PCM, 1 channel
  0x40, 0x1f, 0x00, 0x00, // 8000 Hz
  0x80, 0x3e, 0x00, 0x00, // byte rate
  0x02, 0x00, 0x10, 0x00, // block align + bps
]);

// Matroska/EBML header (webm uses EBML container)
const WEBM_FIXTURE = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML magic
  Buffer.alloc(60, 0),
]);

// OGG: "OggS" magic
const OGG_FIXTURE = Buffer.concat([
  Buffer.from('OggS'),
  Buffer.alloc(60, 0),
]);

describe('sniffAudioMime', () => {
  it('accepts WAV magic bytes', () => {
    const r = sniffAudioMime(WAV_FIXTURE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('audio/wav');
      expect(r.extension).toBe('wav');
    }
  });

  it('accepts WebM magic bytes', () => {
    const r = sniffAudioMime(WEBM_FIXTURE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('audio/webm');
    }
  });

  it('accepts OGG magic bytes', () => {
    const r = sniffAudioMime(OGG_FIXTURE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('audio/ogg');
    }
  });

  it('rejects random bytes with reason=unknown', () => {
    const r = sniffAudioMime(Buffer.from('random gibberish nothing useful'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unknown');
    }
  });

  it('rejects empty buffer', () => {
    const r = sniffAudioMime(Buffer.alloc(0));
    expect(r.ok).toBe(false);
  });

  it('rejects a PNG file (real magic, not allowlisted)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(0)]);
    const r = sniffAudioMime(png);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('disallowed');
      expect(r.detected).toBe('png');
    }
  });

  it('rejects a PDF file (real magic, not allowlisted)', () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, ...new Array(60).fill(0)]);
    const r = sniffAudioMime(pdf);
    expect(r.ok).toBe(false);
  });
});
