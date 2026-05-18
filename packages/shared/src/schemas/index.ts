import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export * from './locale.js';
export * from './auth.js';
export * from './student.js';
export * from './integration.js';
export * from './lesson.js';
export * from './feedback.js';
export * from './games.js';
export * from './voice.js';
