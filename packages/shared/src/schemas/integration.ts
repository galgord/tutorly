import { z } from 'zod';

// ---- Google Calendar integration ----------------------------------------

export const IntegrationStatusResponseSchema = z.object({
  connected: z.boolean(),
  lessonCalendarIds: z.array(z.string()),
});
export type IntegrationStatusResponse = z.infer<typeof IntegrationStatusResponseSchema>;

export const ConnectIntegrationResponseSchema = z.object({
  authUrl: z.string().url(),
});
export type ConnectIntegrationResponse = z.infer<typeof ConnectIntegrationResponseSchema>;

export const GoogleCalendarSummarySchema = z.object({
  id: z.string().min(1),
  summary: z.string(),
  primary: z.boolean().optional(),
  backgroundColor: z.string().optional(),
});
export type GoogleCalendarSummary = z.infer<typeof GoogleCalendarSummarySchema>;

export const ListCalendarsResponseSchema = z.object({
  items: z.array(GoogleCalendarSummarySchema),
});
export type ListCalendarsResponse = z.infer<typeof ListCalendarsResponseSchema>;

/**
 * Typed Google-side error. The API returns this with status 200 instead of
 * a 5xx so the UI can render a useful banner ("quota exceeded, try later")
 * without surfacing a generic crash.
 */
export const IntegrationErrorResponseSchema = z.object({
  error: z.enum(['quota_exceeded', 'disconnected', 'unavailable']),
});
export type IntegrationErrorResponse = z.infer<typeof IntegrationErrorResponseSchema>;

export const UpdateLessonCalendarsRequestSchema = z.object({
  calendarIds: z.array(z.string().min(1)).max(50),
});
export type UpdateLessonCalendarsRequest = z.infer<typeof UpdateLessonCalendarsRequestSchema>;
