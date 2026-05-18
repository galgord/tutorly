/**
 * Injection seam between the api and Anthropic (or any LLM provider). Mirrors
 * the GoogleCalendarClient pattern in `../google/google-calendar.client.ts`:
 *
 *  - tests + dev without an ANTHROPIC_API_KEY → FakeLlmClient (canned JSON)
 *  - dev/prod with the key set                → RealAnthropicLlmClient
 *
 * The interface only exposes what the games module needs (one call), so the
 * test fake stays small and the real implementation can evolve internally
 * without rippling.
 */

import type { BuiltPrompt } from '@tutor-app/shared';

export interface LlmGenerationRequest {
  prompt: BuiltPrompt;
  /** Anthropic model id; the client may pick a default if unset. */
  model?: string;
  /** Defensive output ceiling; the worker passes the schema-derived limit. */
  maxOutputTokens?: number;
}

export interface LlmGenerationResult {
  /**
   * Raw JSON string the model produced (still untrusted — the caller MUST
   * parse and re-validate against the strict shared Zod schema).
   */
  rawJson: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
  model: string;
}

// ---- Typed errors so callers don't depend on Anthropic SDK internals --

export class LlmInvalidOutputError extends Error {
  constructor(message = 'LLM output failed schema validation.') {
    super(message);
    this.name = 'LlmInvalidOutputError';
  }
}

export class LlmRateLimitError extends Error {
  constructor(message = 'LLM provider rate limit exceeded.') {
    super(message);
    this.name = 'LlmRateLimitError';
  }
}

export class LlmUnavailableError extends Error {
  constructor(message = 'LLM provider is temporarily unavailable.') {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

export class LlmAuthError extends Error {
  constructor(message = 'LLM provider authentication failed.') {
    super(message);
    this.name = 'LlmAuthError';
  }
}

export interface LlmClient {
  generate(req: LlmGenerationRequest): Promise<LlmGenerationResult>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
