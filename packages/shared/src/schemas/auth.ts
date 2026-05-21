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
  // White-labeling (upcoming): the tutor's tutoring-practice brand name.
  businessName: z.string().nullable(),
  locale: LocaleSchema,
  // Phase 11: tutor's subject + teaching language. Both optional —
  // pre-existing tutors won't have them set until they edit their profile.
  subject: z.string().nullable(),
  teachingLanguage: LanguageSchema.nullable(),
  // Monthly AI-generation quota — lets the UI show a "X of N used" meter
  // before the tutor hits the cap.
  monthlyGenerations: z.number().int().min(0),
  monthlyGenerationsCap: z.number().int().min(0),
  monthlyGenerationsResetAt: z.string().datetime(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateTutorRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    locale: LocaleSchema.optional(),
    // `null` clears the field; omitting the key leaves it as-is.
    businessName: z.string().trim().min(1).max(120).nullable().optional(),
    subject: z.string().trim().min(1).max(80).nullable().optional(),
    teachingLanguage: LanguageSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field required.' });
export type UpdateTutorRequest = z.infer<typeof UpdateTutorRequestSchema>;
