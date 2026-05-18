-- Phase 5: voice feedback (Whisper) state.
--
-- Adds two columns to Lesson so the upload → transcribe → review flow can
-- track its lifecycle without colliding with the existing feedback fields:
--
--   transcriptionStatus  enum (NONE/PENDING/TRANSCRIBING/DONE/FAILED) — what
--                        the Whisper job is doing right now. Polled by the UI.
--   transcriptionError   tutor-safe error string (no stack traces) populated
--                        only when status = FAILED. Cleared on retry.
--
-- The `audioUrl` column was scaffolded in the Phase 1 init migration; we keep
-- that field name and store a STORAGE_DIR-relative path while the audio file
-- is on disk, then NULL it out after Whisper succeeds (spec: audio deleted
-- post-transcription).

CREATE TYPE "TranscriptionStatus" AS ENUM ('NONE', 'PENDING', 'TRANSCRIBING', 'DONE', 'FAILED');

ALTER TABLE "Lesson"
  ADD COLUMN "transcriptionStatus" "TranscriptionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "transcriptionError" TEXT;

CREATE INDEX "Lesson_transcriptionStatus_idx" ON "Lesson"("transcriptionStatus");
