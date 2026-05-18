import { z } from 'zod';
import { GameTypeSchema, GameStatusSchema } from './games.js';

// Phase 7: aggregated progress shapes the tutor's student-detail dashboard
// consumes. The api computes these from raw Attempt + Game rows; the
// `progress.aggregations` module is the pure-function layer so the
// aggregation can be exhaustively unit-tested without a DB.

export const TrendDirectionSchema = z.enum([
  'improving',
  'stable',
  'declining',
  'insufficient',
]);
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;

/** One per (game, attempt) — the sparkline / trend data for a game card. */
export const SparklinePointSchema = z.object({
  attemptId: z.string().min(1),
  startedAt: z.string().datetime(),
  // 0..1 fraction correct. Stored as fraction (not %) so callers can render
  // either; intl-percent formatting handles the display.
  accuracy: z.number().min(0).max(1),
  score: z.number().int().min(0),
});
export type SparklinePoint = z.infer<typeof SparklinePointSchema>;

export const GameProgressSchema = z.object({
  id: z.string().min(1),
  type: GameTypeSchema,
  title: z.string().min(1),
  status: GameStatusSchema,
  attemptCount: z.number().int().min(0),
  lastAttemptAt: z.string().datetime().nullable(),
  latestAccuracy: z.number().min(0).max(1).nullable(),
  bestAccuracy: z.number().min(0).max(1).nullable(),
  bestScore: z.number().int().min(0).nullable(),
  trend: TrendDirectionSchema,
  // Last 10 completed attempts, oldest → newest.
  sparkline: z.array(SparklinePointSchema).max(10),
});
export type GameProgress = z.infer<typeof GameProgressSchema>;

export const QuestionProgressSchema = z.object({
  questionId: z.string().min(1),
  gameId: z.string().min(1),
  prompt: z.string(),
  topicTags: z.array(z.string()).default([]),
  // Number of times this exact question was seen by the student.
  seenCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  accuracy: z.number().min(0).max(1),
});
export type QuestionProgress = z.infer<typeof QuestionProgressSchema>;

export const TopicTrendPointSchema = z.object({
  // YYYY-MM bucket; aggregated per calendar month in UTC.
  month: z.string().regex(/^\d{4}-\d{2}$/),
  accuracy: z.number().min(0).max(1),
  sampleSize: z.number().int().min(1),
});
export type TopicTrendPoint = z.infer<typeof TopicTrendPointSchema>;

export const TopicProgressSchema = z.object({
  topic: z.string().min(1),
  seenCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  accuracy: z.number().min(0).max(1),
  // Rolling monthly accuracy, oldest → newest. Empty when too sparse.
  points: z.array(TopicTrendPointSchema),
});
export type TopicProgress = z.infer<typeof TopicProgressSchema>;

export const StudentProgressTotalsSchema = z.object({
  totalAttempts: z.number().int().min(0),
  completedAttempts: z.number().int().min(0),
  totalQuestionsAnswered: z.number().int().min(0),
  overallAccuracy: z.number().min(0).max(1).nullable(),
  firstAttemptAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
});
export type StudentProgressTotals = z.infer<typeof StudentProgressTotalsSchema>;

export const StudentProgressResponseSchema = z.object({
  studentId: z.string().min(1),
  totals: StudentProgressTotalsSchema,
  games: z.array(GameProgressSchema),
  topics: z.array(TopicProgressSchema),
  // Top N hardest questions across all games (lowest accuracy first, min 3 attempts).
  hardestQuestions: z.array(QuestionProgressSchema),
});
export type StudentProgressResponse = z.infer<typeof StudentProgressResponseSchema>;

// ---- Paginated attempts log -------------------------------------------

export const AttemptResultLineSchema = z.object({
  questionId: z.string().min(1),
  prompt: z.string(),
  correct: z.boolean(),
  rawAnswer: z.string(),
  expectedAnswer: z.string(),
  topicTags: z.array(z.string()).default([]),
  answeredAt: z.string().datetime(),
  timedOut: z.boolean().optional(),
});
export type AttemptResultLine = z.infer<typeof AttemptResultLineSchema>;

export const AttemptHistoryItemSchema = z.object({
  id: z.string().min(1),
  gameId: z.string().min(1),
  gameTitle: z.string().min(1),
  gameType: GameTypeSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  score: z.number().int().min(0),
  livesLost: z.number().int().min(0),
  questionsAnswered: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  accuracy: z.number().min(0).max(1).nullable(),
  // Detail expanded inline — the list lazy-fetches by id when expanded, but
  // small samples ship the lines too so the row expand is instant.
  results: z.array(AttemptResultLineSchema),
});
export type AttemptHistoryItem = z.infer<typeof AttemptHistoryItemSchema>;

export const AttemptMonthlyAggregateSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  attemptCount: z.number().int().min(0),
  avgAccuracy: z.number().min(0).max(1).nullable(),
});
export type AttemptMonthlyAggregate = z.infer<typeof AttemptMonthlyAggregateSchema>;

export const ListAttemptsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListAttemptsQuery = z.infer<typeof ListAttemptsQuerySchema>;

export const AttemptHistoryResponseSchema = z.object({
  items: z.array(AttemptHistoryItemSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalRecent: z.number().int().min(0),
  hasMore: z.boolean(),
  // Populated only when there are attempts older than the 6-month recent
  // window; pre-aggregated per UTC month so the query stays bounded.
  monthlyAggregates: z.array(AttemptMonthlyAggregateSchema),
  // Cutoff that separates "recent paginated" from "monthly aggregate".
  monthlyCutoff: z.string().datetime(),
});
export type AttemptHistoryResponse = z.infer<typeof AttemptHistoryResponseSchema>;
