import { z } from 'zod';

// ---- Feedback ----------------------------------------------------------

export const FeedbackSourceSchema = z.enum(['TEXT', 'VOICE']);
export type FeedbackSourceLiteral = z.infer<typeof FeedbackSourceSchema>;

/**
 * Tutor-supplied free-text feedback for a lesson. Hard cap on length so a
 * runaway paste doesn't blow up an LLM prompt (~8k chars is well under any
 * model's input limit and still gives the tutor room to be thorough).
 * Phase 4 is TEXT-only; VOICE arrives in Phase 5 via a separate upload
 * endpoint that updates the same field.
 */
export const UpdateFeedbackRequestSchema = z.object({
  feedbackText: z.string().trim().min(1, 'Feedback text required.').max(8_000),
});
export type UpdateFeedbackRequest = z.infer<typeof UpdateFeedbackRequestSchema>;

/**
 * Tutor-supplied free-text plan / agenda for a lesson. Unlike feedback this
 * is editable at any time (before the session as a plan, after as a record
 * of what was covered) and an empty string is allowed — that clears it.
 * Capped well under any LLM input limit, consistent with feedback.
 */
export const UpdateAgendaRequestSchema = z.object({
  agenda: z.string().trim().max(4_000),
});
export type UpdateAgendaRequest = z.infer<typeof UpdateAgendaRequestSchema>;
