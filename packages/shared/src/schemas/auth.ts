import { z } from 'zod';
import { LanguageSchema, LocaleSchema } from './locale.js';

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkResponseSchema = z.object({
  ok: z.literal(true),
  /** Only set when API runs in non-prod. Lets tests/dev skip the inbox. */
  devMagicLinkUrl: z.string().url().optional(),
});
export type MagicLinkResponse = z.infer<typeof MagicLinkResponseSchema>;

export const MeResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  locale: LocaleSchema,
  // Phase 11: tutor's subject + teaching language. Both optional —
  // pre-existing tutors won't have them set until they edit their profile.
  subject: z.string().nullable(),
  teachingLanguage: LanguageSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateTutorRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    locale: LocaleSchema.optional(),
    // `null` clears the field; omitting the key leaves it as-is.
    subject: z.string().trim().min(1).max(80).nullable().optional(),
    teachingLanguage: LanguageSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field required.' });
export type UpdateTutorRequest = z.infer<typeof UpdateTutorRequestSchema>;
