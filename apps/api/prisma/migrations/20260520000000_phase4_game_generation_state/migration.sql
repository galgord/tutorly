-- Phase 4: add GameStatus values for the in-flight + failed generation
-- states, plus a column to surface the failure reason to the tutor.
ALTER TYPE "GameStatus" ADD VALUE 'GENERATING';
ALTER TYPE "GameStatus" ADD VALUE 'FAILED';

ALTER TABLE "Game" ADD COLUMN "generationError" TEXT;
