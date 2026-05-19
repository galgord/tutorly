-- Phase 11: tutor subject ("what do you teach?") + teachingLanguage
-- ("what language are your lessons / generated questions in?") and student
-- nativeLanguage ("what's your student's L1?"). All optional so existing
-- tutors and students migrate cleanly with NULLs.
ALTER TABLE "Tutor" ADD COLUMN "subject" TEXT;
ALTER TABLE "Tutor" ADD COLUMN "teachingLanguage" TEXT;
ALTER TABLE "Student" ADD COLUMN "nativeLanguage" TEXT;
