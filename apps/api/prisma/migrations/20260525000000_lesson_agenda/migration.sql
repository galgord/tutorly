-- Phase: lesson agenda — a free-text session plan editable at any time,
-- distinct from feedbackText (post-lesson notes that drive game generation).
ALTER TABLE "Lesson" ADD COLUMN "agenda" TEXT;
