/**
 * Attempt-flow schemas (Phase 6).
 *
 * All three endpoints below are mounted under `/s/:shareToken/...` and
 * gated only by the share token. NO session cookie, NO CSRF — the token
 * IS the credential. Tutor-scoped views (attempt history) ship later in
 * Phase 7.
 *
 * Server-side scoring is source of truth: the start endpoint returns
 * client-safe questions (prompt + distractors only), and the answer
 * endpoint POSTs `rawAnswer` (or `choiceIndex`) which the server
 * normalizes + scores.
 *
 * `questionResults` (persisted on Attempt) uses
 * `QuestionResultRecordSchema` — Phase 7 reads back through that schema
 * for the tutor dashboard.
 */

import { z } from 'zod';
import { GameTypeSchema, type GameTypeLiteral } from './games.js';
import { RawAnswerSchema } from './answers.js';
import { LocaleSchema } from './locale.js';

// ---- Public game listing (extension to GET /s/:shareToken) ------------

/**
 * Compact projection of an ASSIGNED game shown on the student's
 * dashboard. Deliberately omits the full `questionPool` — the play
 * endpoint returns the per-attempt sampled subset instead so the whole
 * pool is never exfiltrated wholesale via the share link.
 */
export const PublicGameSummarySchema = z.object({
  id: z.string().min(1),
  type: GameTypeSchema,
  title: z.string().min(1),
  locale: LocaleSchema,
  /** Pool size (informational) so the UI can hint "10 questions". */
  poolSize: z.number().int().min(1),
  /** ISO timestamp of the most recently finished attempt by this student
   *  on this game; `null` if never played. Drives the "played X" badge. */
  lastPlayedAt: z.string().datetime().nullable(),
  /** Highest score the student has achieved on this game, used for the
   *  game-over screen's "best ever" line. `null` if no finished attempts. */
  bestScore: z.number().int().min(0).nullable(),
});
export type PublicGameSummary = z.infer<typeof PublicGameSummarySchema>;

export const PublicStudentDashboardResponseSchema = z.object({
  name: z.string(),
  games: z.array(PublicGameSummarySchema),
});
export type PublicStudentDashboardResponse = z.infer<typeof PublicStudentDashboardResponseSchema>;

// ---- POST /s/:shareToken/games/:gameId/attempts (start) ----------------

/** What the client sees per question while playing. Critically: no answer. */
export const PublicQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1).max(500),
  /** Empty for FILL_BLANK; ≥1 for TIMED_QUIZ. Server pre-shuffles. */
  choices: z.array(z.string().min(1).max(200)).max(8).default([]),
  topicTags: z.array(z.string()).default([]),
});
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

export const StartAttemptResponseSchema = z.object({
  attemptId: z.string().min(1),
  gameId: z.string().min(1),
  type: GameTypeSchema,
  locale: LocaleSchema,
  questions: z.array(PublicQuestionSchema).min(1),
  livesAllowed: z.number().int().min(0),
  /** seconds per question; 0 for FILL_BLANK (untimed) */
  perQuestionSeconds: z.number().int().min(0),
});
export type StartAttemptResponse = z.infer<typeof StartAttemptResponseSchema>;

// ---- PATCH /s/:shareToken/attempts/:attemptId/answers ------------------

/**
 * Per-question answer submission. Either `rawAnswer` (FILL_BLANK) or
 * `choiceIndex` (TIMED_QUIZ) must be present; the server picks based on
 * the game type so callers can send both without harm (server uses the
 * one its game type cares about).
 *
 * `timedOut` lets the TIMED_QUIZ engine signal "the user didn't answer
 * in time" without inventing a sentinel value for `choiceIndex`. Counts
 * as wrong + costs a life.
 */
export const SubmitAnswerRequestSchema = z
  .object({
    questionId: z.string().min(1),
    rawAnswer: RawAnswerSchema.optional(),
    choiceIndex: z.number().int().min(0).max(7).optional(),
    timedOut: z.boolean().optional(),
  })
  .refine(
    (v) => v.rawAnswer !== undefined || v.choiceIndex !== undefined || v.timedOut === true,
    { message: 'Provide rawAnswer, choiceIndex, or timedOut.' },
  );
export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;

export const SubmitAnswerResponseSchema = z.object({
  questionId: z.string().min(1),
  correct: z.boolean(),
  correctAnswer: z.string(),
  scoreSoFar: z.number().int().min(0),
  /** Only present for TIMED_QUIZ. */
  livesRemaining: z.number().int().min(0).optional(),
  /** True once the engine should stop accepting answers (out of lives or
   *  out of questions). The client transitions to game-over. */
  gameOver: z.boolean(),
});
export type SubmitAnswerResponse = z.infer<typeof SubmitAnswerResponseSchema>;

// ---- POST /s/:shareToken/attempts/:attemptId/finish --------------------

export const FinishAttemptResponseSchema = z.object({
  attemptId: z.string().min(1),
  gameId: z.string().min(1),
  score: z.number().int().min(0),
  total: z.number().int().min(0),
  livesLost: z.number().int().min(0),
  finishedAt: z.string().datetime(),
  /** Best score across the student's PRIOR attempts on this game; the
   *  current attempt is excluded so "you beat your best!" reads cleanly. */
  bestEver: z.number().int().min(0),
});
export type FinishAttemptResponse = z.infer<typeof FinishAttemptResponseSchema>;

// ---- Persisted per-question result (Attempt.questionResults JSON) -----

/**
 * One entry per answered question — Phase 7 reads this to render
 * per-question detail to the tutor. Designed once now to avoid a Phase 7
 * data migration: every field the dashboard will need is captured.
 *
 * Storage shape is an array; we wrap reads through this schema so a
 * future field addition can default safely.
 */
export const QuestionResultRecordSchema = z.object({
  questionId: z.string().min(1),
  prompt: z.string(),
  correct: z.boolean(),
  /** Raw text the student typed (FILL_BLANK) — kept verbatim for the
   *  tutor's review. Empty string for TIMED_QUIZ where they picked a
   *  choice instead. */
  rawAnswer: z.string(),
  normalizedAnswer: z.string(),
  expectedAnswer: z.string(),
  answeredAt: z.string().datetime(),
  topicTags: z.array(z.string()).default([]),
  /** TIMED_QUIZ only: which choice index was picked, or -1 for timeout. */
  choiceIndex: z.number().int().min(-1).max(7).optional(),
  timedOut: z.boolean().optional(),
});
export type QuestionResultRecord = z.infer<typeof QuestionResultRecordSchema>;

export const QuestionResultsArraySchema = z.array(QuestionResultRecordSchema);

// ---- Engine constants exposed to the web client ------------------------

/**
 * Session-size and lives defaults the api uses when sampling. Exposed
 * here so the web engine can compute progress bars without an extra
 * server round-trip.
 */
export const DEFAULT_FILL_BLANK_SESSION_SIZE = 10;
export const DEFAULT_TIMED_QUIZ_SESSION_SIZE = 20;
export const TIMED_QUIZ_LIVES = 3;
export const TIMED_QUIZ_PER_QUESTION_SECONDS = 20;

/** Pick the per-type session size; the api may override via env vars. */
export function defaultSessionSize(type: GameTypeLiteral): number {
  return type === 'FILL_BLANK' ? DEFAULT_FILL_BLANK_SESSION_SIZE : DEFAULT_TIMED_QUIZ_SESSION_SIZE;
}
