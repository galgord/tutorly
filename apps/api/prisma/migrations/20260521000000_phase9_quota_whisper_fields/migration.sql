-- Phase 9: Whisper minute quota tracking on Tutor. The increment lives
-- with Phase 5 (when audio jobs run); this migration just adds the
-- columns so the schema is stable.
ALTER TABLE "Tutor" ADD COLUMN "monthlyWhisperMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tutor" ADD COLUMN "monthlyWhisperResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
