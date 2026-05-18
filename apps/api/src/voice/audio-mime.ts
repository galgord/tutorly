import { filetypeextension, filetypename } from 'magic-bytes.js';

/**
 * Audio MIME-sniffing for the upload endpoint. We DO NOT trust the
 * incoming `Content-Type` header — a malicious client can send anything
 * regardless of the actual bytes. Instead we read the file's first few
 * KB and match against the allowlist of formats MediaRecorder commonly
 * emits in browsers we support.
 *
 * Allowed:
 *   - webm  (Chrome/Firefox MediaRecorder default; opus/vorbis codecs)
 *   - ogg   (Firefox MediaRecorder fallback; opus/vorbis)
 *   - mp4   (Safari MediaRecorder; aac inside)
 *   - m4a   (Safari sometimes labels as audio/m4a, same container)
 *   - wav   (debug + Playwright fixture friendliness)
 *
 * Rejected:
 *   - everything else (mp3, flac, etc. — not what MediaRecorder produces,
 *     so refusing keeps the attack surface small).
 *
 * Returns the canonical mime string on success, null on rejection.
 */

// magic-bytes.js doesn't differentiate between Ogg-audio (oga/opus) and
// Ogg-video — both surface as `ogx`. We accept `ogx` knowing the upstream
// Whisper API will fail-closed on actual video files.
const ALLOWED_NAMES = new Set(['webm', 'ogg', 'ogx', 'mp4', 'm4a', 'wav', 'aac']);

/**
 * The MIME we report back to the client when validation passes. Whisper
 * doesn't care about the exact mime in our request (it sniffs server-side
 * too), but having a canonical value keeps audit metadata predictable.
 */
const CANONICAL_MIME: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  ogx: 'audio/ogg',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
};

/** How many leading bytes magic-bytes.js needs. 64 is plenty for our set. */
export const MIME_SNIFF_BYTES = 4_100;

export interface SniffResult {
  ok: true;
  mime: string;
  extension: string;
}

export interface SniffRejection {
  ok: false;
  reason: 'unknown' | 'disallowed';
  detected: string | null;
}

export function sniffAudioMime(buffer: Buffer): SniffResult | SniffRejection {
  // magic-bytes returns an array of candidate file-type names (lowercase).
  const head = buffer.subarray(0, MIME_SNIFF_BYTES);
  const candidates: string[] = filetypename(head) as string[];
  if (!candidates || candidates.length === 0) {
    return { ok: false, reason: 'unknown', detected: null };
  }
  for (const cand of candidates) {
    const name = cand.toLowerCase();
    if (ALLOWED_NAMES.has(name)) {
      const exts = (filetypeextension(head) as string[]) ?? [];
      // For `ogx` we prefer the more idiomatic `ogg` extension on disk.
      const preferred = name === 'ogx' ? 'ogg' : name;
      const ext = exts.find((e) => e.toLowerCase() === preferred) ?? preferred;
      return { ok: true, mime: CANONICAL_MIME[name] ?? `audio/${name}`, extension: ext };
    }
  }
  return { ok: false, reason: 'disallowed', detected: candidates[0] ?? null };
}
