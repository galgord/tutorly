import { z } from 'zod';
import { FeedbackSourceSchema } from './feedback.js';
import { TranscriptionStatusSchema } from './voice.js';

// ---- Lessons -----------------------------------------------------------

export const LessonSourceSchema = z.enum(['GOOGLE_CALENDAR', 'MANUAL']);
export type LessonSourceLiteral = z.infer<typeof LessonSourceSchema>;

const StudentIdField = z.string().min(1, 'studentId required.');
const TitleField = z.string().trim().min(1).max(200);

export const CreateLessonRequestSchema = z
  .object({
    studentId: StudentIdField,
    // Permissive ISO; backend re-validates with Date constructor.
    occurredAt: z.string().datetime(),
    title: TitleField.optional(),
    googleEventId: z.string().min(1).optional(),
  })
  // Reject empty body shapes.
  .refine((v) => !!v.studentId && !!v.occurredAt, {
    message: 'studentId and occurredAt are required.',
  });
export type CreateLessonRequest = z.infer<typeof CreateLessonRequestSchema>;

export const ListLessonsQuerySchema = z.object({
  studentId: StudentIdField,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListLessonsQuery = z.infer<typeof ListLessonsQuerySchema>;

export const CalendarRangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});
export type CalendarRangeQuery = z.infer<typeof CalendarRangeQuerySchema>;

export const LessonResponseSchema = z.object({
  id: z.string().min(1),
  studentId: z.string().min(1),
  studentName: z.string().nullable().optional(),
  source: LessonSourceSchema,
  title: z.string().nullable(),
  occurredAt: z.string().datetime(),
  googleEventId: z.string().nullable(),
  feedbackText: z.string().nullable(),
  feedbackSource: FeedbackSourceSchema,
  transcriptionStatus: TranscriptionStatusSchema,
  transcriptionError: z.string().nullable(),
  hasAudio: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type LessonResponse = z.infer<typeof LessonResponseSchema>;

export const LessonListResponseSchema = z.object({
  items: z.array(LessonResponseSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type LessonListResponse = z.infer<typeof LessonListResponseSchema>;

// Merge endpoint: combines local Lesson rows with raw Google events. Items
// without a `localLessonId` exist only on Google; items with it have either
// both or just the local row (orphan case after Google event deletion).
export const CalendarItemSchema = z.object({
  source: LessonSourceSchema,
  googleEventId: z.string().nullable(),
  title: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  hasLocalLesson: z.boolean(),
  localLessonId: z.string().nullable(),
  studentId: z.string().nullable(),
  studentName: z.string().nullable(),
  calendarId: z.string().nullable(),
});
export type CalendarItem = z.infer<typeof CalendarItemSchema>;

export const CalendarMergeResponseSchema = z.object({
  items: z.array(CalendarItemSchema),
});
export type CalendarMergeResponse = z.infer<typeof CalendarMergeResponseSchema>;
