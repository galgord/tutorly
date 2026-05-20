import { z } from 'zod';
import { LocaleSchema } from './locale.js';

// ---- Games + questions -------------------------------------------------

export const GameTypeSchema = z.enum(['FILL_BLANK', 'TIMED_QUIZ']);
export type GameTypeLiteral = z.infer<typeof GameTypeSchema>;

// DRAFT — generated, awaiting tutor review
// GENERATING — LLM job in flight (pool empty until it finishes)
// FAILED — LLM job exhausted retries; tutor can regenerate or rephrase
// ASSIGNED — published to the student via their share-link dashboard
// ARCHIVED — soft-deleted but preserved because attempts reference it
export const GameStatusSchema = z.enum([
  'DRAFT',
  'GENERATING',
  'FAILED',
  'ASSIGNED',
  'ARCHIVED',
]);
export type GameStatusLiteral = z.infer<typeof GameStatusSchema>;

// Per-question shape. Reused for both FILL_BLANK and TIMED_QUIZ; per-type
// extras (`distractors`, `acceptAlternates`) are optional. Server enforces
// type-specific invariants on persist (fill-blank questions must contain
// "___"; timed quiz questions must have ≥3 distractors).
const TopicTagsField = z
  .array(z.string().trim().min(1).max(40))
  .max(5)
  .default([]);

// Phase 12: per-question difficulty on a 1 (easiest) … 5 (hardest) scale.
// LLM-assigned at generation; heuristic-backfilled for pre-existing pools.
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;
export const DEFAULT_DIFFICULTY = 3;

/** What the LLM returns. `id` is server-assigned, so it's omitted here. */
export const LlmQuestionSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(200),
  // Multiple-choice distractors for TIMED_QUIZ. Empty/omitted for FILL_BLANK.
  distractors: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
  // Tutor-curated alternate accepted answers (synonyms, alternate spellings).
  // The LLM may seed these, the tutor edits before assigning.
  acceptAlternates: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  topicTags: TopicTagsField,
  // Optional — the worker clamps + defaults when the model omits it.
  difficulty: z.coerce.number().int().min(MIN_DIFFICULTY).max(MAX_DIFFICULTY).optional(),
});
export type LlmQuestion = z.infer<typeof LlmQuestionSchema>;

export const LlmGenerationResponseSchema = z.object({
  questions: z.array(LlmQuestionSchema).min(1).max(50),
});
export type LlmGenerationResponse = z.infer<typeof LlmGenerationResponseSchema>;

/** Persisted question, post LLM + server-side normalization. */
export const GameQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(200),
  distractors: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  acceptAlternates: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  topicTags: TopicTagsField,
  // `.default` keeps pre-Phase-12 pools (no difficulty key) parsing as "medium".
  difficulty: z.coerce
    .number()
    .int()
    .min(MIN_DIFFICULTY)
    .max(MAX_DIFFICULTY)
    .default(DEFAULT_DIFFICULTY),
});
export type GameQuestion = z.infer<typeof GameQuestionSchema>;

// ---- Request bodies ----------------------------------------------------

export const CreateGameRequestSchema = z.object({
  type: GameTypeSchema,
  // Tutor may want a smaller or larger pool. Default 30 matches spec.
  poolSize: z.coerce.number().int().min(5).max(50).default(30),
  // Per-game override of tutor's preferred locale. Defaults to tutor.locale
  // at the controller layer (we don't know it here).
  locale: LocaleSchema.optional(),
});
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;

export const UpdateGameRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  // Full replacement of the pool — the review modal sends the edited list back.
  questions: z.array(GameQuestionSchema).min(1).max(50).optional(),
});
export type UpdateGameRequest = z.infer<typeof UpdateGameRequestSchema>;

export const RegenerateQuestionRequestSchema = z.object({
  questionId: z.string().min(1),
});
export type RegenerateQuestionRequest = z.infer<typeof RegenerateQuestionRequestSchema>;

// ---- Response shapes ---------------------------------------------------

export const GameResponseSchema = z.object({
  id: z.string().min(1),
  lessonId: z.string().min(1),
  type: GameTypeSchema,
  title: z.string().min(1),
  status: GameStatusSchema,
  questionPool: z.array(GameQuestionSchema),
  poolSize: z.number().int().min(1),
  locale: z.string().min(2),
  generationError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assignedAt: z.string().datetime().nullable(),
});
export type GameResponse = z.infer<typeof GameResponseSchema>;

export const GameListResponseSchema = z.object({
  items: z.array(GameResponseSchema),
});
export type GameListResponse = z.infer<typeof GameListResponseSchema>;

export const GameCreatedResponseSchema = z.object({
  game: GameResponseSchema,
});
export type GameCreatedResponse = z.infer<typeof GameCreatedResponseSchema>;

export const QuotaExceededResponseSchema = z.object({
  error: z.literal('quota_exceeded'),
  cap: z.number().int().min(1),
  used: z.number().int().min(0),
  resetsAt: z.string().datetime(),
});
export type QuotaExceededResponse = z.infer<typeof QuotaExceededResponseSchema>;
