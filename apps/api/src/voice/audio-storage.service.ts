import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ConfigService } from '../config/config.service';

/**
 * Local-filesystem audio storage. v1 stores files under STORAGE_DIR
 * (a Railway Volume mount in prod; `./var/audio` in dev). The store keeps
 * paths SCOPED under the configured root — we always strip back to a
 * relative path before persisting so a future R2/S3 migration only
 * needs to swap the implementation, not migrate stored paths.
 *
 * Per spec: audio files are deleted immediately after successful
 * transcription. The lesson row's `audioUrl` is set back to NULL when
 * we delete (caller's responsibility).
 */
@Injectable()
export class AudioStorageService {
  private readonly logger = new Logger(AudioStorageService.name);
  private readonly rootDir: string;

  constructor(private readonly config: ConfigService) {
    // Resolve once at construction so subsequent path-safety checks are
    // a simple prefix-relative computation.
    this.rootDir = resolve(this.config.get('STORAGE_DIR'));
  }

  /**
   * Persist a binary buffer at `<root>/lessons/<lessonId>/<filename>`.
   * Returns the storage-relative path (suitable for storing in
   * `Lesson.audioUrl` and re-resolving via `absolutePath`).
   */
  async save(opts: {
    lessonId: string;
    fileName: string;
    bytes: Buffer;
  }): Promise<{ relativePath: string; absolutePath: string }> {
    const safeName = sanitizeFileName(opts.fileName);
    const lessonDir = join(this.rootDir, 'lessons', opts.lessonId);
    await fs.mkdir(lessonDir, { recursive: true });
    const abs = join(lessonDir, safeName);
    this.ensureWithinRoot(abs);
    await fs.writeFile(abs, opts.bytes, { flag: 'w' });
    return { relativePath: relative(this.rootDir, abs), absolutePath: abs };
  }

  /**
   * Re-resolve a storage-relative path back to an absolute disk path.
   * Throws if the result would escape the storage root — defense in
   * depth in case a malformed value ended up in the DB.
   */
  absolutePath(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new Error('audio storage: absolute paths rejected, use relative.');
    }
    const abs = resolve(this.rootDir, relativePath);
    this.ensureWithinRoot(abs);
    return abs;
  }

  /**
   * Delete a previously-saved audio file by its storage-relative path.
   * Logs and swallows missing-file errors (idempotent cleanup is the
   * point of calling this in the queue's finally-block).
   */
  async delete(relativePath: string): Promise<void> {
    try {
      const abs = this.absolutePath(relativePath);
      await fs.unlink(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      this.logger.warn(`audio storage delete failed: ${(err as Error).message}`);
    }
  }

  private ensureWithinRoot(abs: string): void {
    const rel = relative(this.rootDir, abs);
    if (rel.startsWith('..') || rel.startsWith(sep) || isAbsolute(rel)) {
      throw new Error(`audio storage: path escapes root (${abs}).`);
    }
  }
}

/**
 * Strip path separators and weird characters from a filename. Keeps the
 * extension hint so post-mortem inspection of the storage dir is sensible,
 * but never trusts the original characters.
 */
export function sanitizeFileName(name: string): string {
  // Drop everything up to the last separator (defense vs `dir/../name`).
  const base = name.split(/[\\/]/).pop() ?? 'audio';
  // Whitelist ascii alphanum + a few harmless punctuation chars.
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  return cleaned.length > 0 ? cleaned : 'audio';
}
