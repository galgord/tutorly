import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import { AudioStorageService, sanitizeFileName } from './audio-storage.service';

function makeConfig(dir: string): ConfigService {
  return {
    get: vi.fn((k: string) => (k === 'STORAGE_DIR' ? dir : undefined)),
    isProd: () => false,
  } as unknown as ConfigService;
}

describe('AudioStorageService', () => {
  let dir: string;
  let svc: AudioStorageService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audio-store-'));
    svc = new AudioStorageService(makeConfig(dir));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('save writes the buffer under <root>/lessons/<id>/ and returns relative path', async () => {
    const result = await svc.save({
      lessonId: 'les_123',
      fileName: 'whatever.webm',
      bytes: Buffer.from('hello'),
    });
    expect(result.relativePath).toContain('lessons/les_123');
    expect(readFileSync(result.absolutePath).toString()).toBe('hello');
  });

  it('absolutePath round-trips a relative path back to the absolute', async () => {
    const saved = await svc.save({
      lessonId: 'les_x',
      fileName: 'a.webm',
      bytes: Buffer.from('x'),
    });
    expect(svc.absolutePath(saved.relativePath)).toBe(saved.absolutePath);
  });

  it('absolutePath refuses absolute paths', () => {
    expect(() => svc.absolutePath('/etc/passwd')).toThrow(/absolute/);
  });

  it('absolutePath refuses paths that escape the storage root', () => {
    expect(() => svc.absolutePath('../../../../etc/passwd')).toThrow(/escapes root/);
  });

  it('delete removes the file', async () => {
    const saved = await svc.save({
      lessonId: 'les_y',
      fileName: 'b.webm',
      bytes: Buffer.from('y'),
    });
    expect(existsSync(saved.absolutePath)).toBe(true);
    await svc.delete(saved.relativePath);
    expect(existsSync(saved.absolutePath)).toBe(false);
  });

  it('delete is idempotent on missing files', async () => {
    await expect(svc.delete('lessons/missing/x.webm')).resolves.toBeUndefined();
  });

  it('sanitizeFileName strips path separators and weird chars', () => {
    expect(sanitizeFileName('../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('weird name!!.webm')).toBe('weird_name__.webm');
    expect(sanitizeFileName('')).toBe('audio');
    expect(sanitizeFileName('a'.repeat(200))).toHaveLength(100);
  });

  it('save sanitizes the requested filename', async () => {
    const saved = await svc.save({
      lessonId: 'les_z',
      fileName: '../../escape attempt.webm',
      bytes: Buffer.from('z'),
    });
    // The file is under les_z dir, never above the root.
    expect(saved.absolutePath).toContain('lessons/les_z/');
    expect(saved.absolutePath).not.toContain('..');
  });
});
