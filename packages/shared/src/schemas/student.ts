import { z } from 'zod';
import { LanguageSchema } from './locale.js';

// ---- Field-level building blocks ----------------------------------------

const NameField = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(120, 'Name must be 120 characters or fewer.');

const NotesField = z
  .string()
  .trim()
  .max(2000, 'Notes must be 2000 characters or fewer.')
  // Empty string is normalized to null at the controller level.
  .or(z.literal(''));

const QueryString = z.string().trim().max(120).optional();

// Cursor-free page/limit; keeps the v1 list API simple.
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

// ---- Requests -----------------------------------------------------------

export const CreateStudentRequestSchema = z.object({
  name: NameField,
  notes: NotesField.optional(),
  // Phase 11: student's L1. Optional at create time — the tutor can fill
  // it in later. `null` is treated as "unknown".
  nativeLanguage: LanguageSchema.nullable().optional(),
});
export type CreateStudentRequest = z.infer<typeof CreateStudentRequestSchema>;

export const UpdateStudentRequestSchema = z
  .object({
    name: NameField.optional(),
    notes: NotesField.nullable().optional(),
    nativeLanguage: LanguageSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field required.' });
export type UpdateStudentRequest = z.infer<typeof UpdateStudentRequestSchema>;

export const ListStudentsQuerySchema = PaginationSchema.extend({
  q: QueryString,
});
export type ListStudentsQuery = z.infer<typeof ListStudentsQuerySchema>;

// ---- Responses ----------------------------------------------------------

export const StudentResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  notes: z.string().nullable(),
  nativeLanguage: LanguageSchema.nullable(),
  shareToken: z.string().min(1),
  shareTokenRotatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type StudentResponse = z.infer<typeof StudentResponseSchema>;

/** Per-student engagement summary attached to list responses. Used by the
 *  tutor-facing students list + dashboard cards to show mastery / activity /
 *  assignment counts without an N+1 fetch on `/students/:id/progress`. */
export const StudentSummarySchema = z.object({
  /** Count of completed (finished) attempts. */
  totalAttempts: z.number().int().min(0),
  /** Most recent finished-attempt timestamp; null = student has never played. */
  lastAttemptAt: z.string().datetime().nullable(),
  /** Correct answers / total answered, across all completed attempts. Null
   *  when the student has no answered questions. */
  overallAccuracy: z.number().min(0).max(1).nullable(),
  /** Practice games currently assigned to the student (status=ASSIGNED). */
  assignedGamesCount: z.number().int().min(0),
});
export type StudentSummary = z.infer<typeof StudentSummarySchema>;

export const StudentListItemSchema = StudentResponseSchema.extend({
  summary: StudentSummarySchema,
});
export type StudentListItem = z.infer<typeof StudentListItemSchema>;

export const StudentListResponseSchema = z.object({
  items: z.array(StudentListItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type StudentListResponse = z.infer<typeof StudentListResponseSchema>;

export const RotateTokenResponseSchema = z.object({
  shareToken: z.string().min(1),
  shareTokenRotatedAt: z.string().datetime(),
});
export type RotateTokenResponse = z.infer<typeof RotateTokenResponseSchema>;

// Public-facing student dashboard (token-based, no session).
export const PublicStudentResponseSchema = z.object({
  name: z.string(),
});
export type PublicStudentResponse = z.infer<typeof PublicStudentResponseSchema>;
