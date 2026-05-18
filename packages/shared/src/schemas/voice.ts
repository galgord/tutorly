import { z } from 'zod';

// ---- Voice (Phase 5) ---------------------------------------------------

/**
 * Lifecycle of the Whisper transcription for a lesson's audio upload.
 * Mirrors the Prisma `TranscriptionStatus` enum.
 *
 *   NONE         - no audio uploaded yet (default)
 *   PENDING      - uploaded, queued, not yet picked up by the worker
 *   TRANSCRIBING - worker is actively calling Whisper
 *   DONE         - transcript written into `feedbackText` (suggestion;
 *                  tutor still needs to save to commit)
 *   FAILED       - terminal failure; `transcriptionError` populated
 */
export const TranscriptionStatusSchema = z.enum([
  'NONE',
  'PENDING',
  'TRANSCRIBING',
  'DONE',
  'FAILED',
]);
export type TranscriptionStatusLiteral = z.infer<typeof TranscriptionStatusSchema>;

/**
 * Hard caps the spec calls out explicitly. The api enforces both server-side
 * (multer file-size + post-upload duration check); these constants are
 * exported so the web client can pre-validate before bothering to upload.
 */
export const VOICE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const VOICE_MAX_DURATION_SECONDS = 5 * 60; // 5 minutes

/**
 * Response shape for `POST /lessons/:id/audio` and any status poll. The
 * UI polls `transcriptionStatus` to flip the recorder UI from PENDING →
 * TRANSCRIBING → DONE, then re-fetches the lesson to display the
 * suggested feedback text.
 */
export const TranscriptionStatusResponseSchema = z.object({
  lessonId: z.string().min(1),
  transcriptionStatus: TranscriptionStatusSchema,
  transcriptionError: z.string().nullable(),
  hasAudio: z.boolean(),
});
export type TranscriptionStatusResponse = z.infer<typeof TranscriptionStatusResponseSchema>;
