/**
 * Injection seam between the api and OpenAI Whisper (or any transcription
 * provider). Mirrors the LlmClient pattern in
 * `../anthropic/llm.client.ts`:
 *
 *  - tests + dev without an OPENAI_API_KEY → FakeTranscriberClient (canned text)
 *  - dev/prod with the key set             → RealOpenAIWhisperClient
 *
 * The interface only exposes what the voice module needs (one call), so the
 * test fake stays small and the real implementation can evolve internally
 * without rippling.
 */

import type { Locale } from '@tutor-app/shared';

export interface TranscriptionRequest {
  /** Absolute path to the audio file on local disk. */
  audioPath: string;
  /** Tutor's UI locale, passed as the Whisper `language` hint for pt/he accuracy. */
  locale: Locale;
  /** Reported duration in seconds (used only for logging in the real client). */
  durationSeconds: number;
}

export interface TranscriptionResult {
  /** UTF-8 transcript text. Untrusted from the model's perspective — caller
   *  should still treat as PII and never log it. */
  text: string;
  /** Whisper-detected language (BCP-47-ish, e.g. `en`, `he`). May differ
   *  from the hint when the speaker actually uses a different language. */
  detectedLanguage?: string;
  /** Provider model identifier. */
  model: string;
}

// ---- Typed errors so callers don't depend on OpenAI SDK internals ----

export class TranscriptionRateLimitError extends Error {
  constructor(message = 'Whisper provider rate limit exceeded.') {
    super(message);
    this.name = 'TranscriptionRateLimitError';
  }
}

export class TranscriptionUnavailableError extends Error {
  constructor(message = 'Whisper provider is temporarily unavailable.') {
    super(message);
    this.name = 'TranscriptionUnavailableError';
  }
}

export class TranscriptionAuthError extends Error {
  constructor(message = 'Whisper provider authentication failed.') {
    super(message);
    this.name = 'TranscriptionAuthError';
  }
}

/** Thrown when the audio file is rejected by Whisper for content reasons
 *  (corrupt, unsupported codec we missed in the magic-byte sniff, etc.). Not
 *  retryable — we mark the lesson FAILED and refund the slot. */
export class TranscriptionInvalidInputError extends Error {
  constructor(message = 'Whisper rejected the audio file.') {
    super(message);
    this.name = 'TranscriptionInvalidInputError';
  }
}

export interface TranscriberClient {
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>;
}

export const TRANSCRIBER_CLIENT = Symbol('TRANSCRIBER_CLIENT');
