import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import { ConfigService } from '../../config/config.service';
import {
  type TranscriberClient,
  type TranscriptionRequest,
  type TranscriptionResult,
  TranscriptionAuthError,
  TranscriptionInvalidInputError,
  TranscriptionRateLimitError,
  TranscriptionUnavailableError,
} from './whisper.client';

const DEFAULT_MODEL = 'whisper-1';

/**
 * Real OpenAI Whisper-backed TranscriberClient.
 *
 * Behaviors:
 *  - Streams the audio from disk (no buffer copy) directly into the
 *    OpenAI SDK's multipart upload helper.
 *  - Passes the tutor's locale as the `language` hint — Whisper accuracy
 *    on pt/he is meaningfully better with it set.
 *  - Maps OpenAI SDK errors to typed `TranscriptionRateLimitError` /
 *    `TranscriptionUnavailableError` / `TranscriptionAuthError` /
 *    `TranscriptionInvalidInputError` so the caller doesn't depend on
 *    SDK internals.
 *  - Does NOT do its own retries — the WhisperJobQueue drives retry +
 *    circuit-breaker policy so behavior is observable in one place.
 */
@Injectable()
export class RealOpenAIWhisperClient implements TranscriberClient {
  private readonly logger = new Logger(RealOpenAIWhisperClient.name);
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('RealOpenAIWhisperClient requires OPENAI_API_KEY.');
    }
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    try {
      const res = await this.client.audio.transcriptions.create({
        model: DEFAULT_MODEL,
        file: createReadStream(req.audioPath),
        // BCP-47-ish 2-letter hint; Whisper accepts `en`, `he`, `pt` etc.
        language: req.locale,
        // `verbose_json` returns the detected language so we can log
        // mismatches. The transcript string is in `.text` either way.
        response_format: 'verbose_json',
      });

      // `verbose_json` shape: { text, language, segments[], ... }. The SDK
      // types this as a discriminated union; access conservatively.
      const verbose = res as unknown as { text?: string; language?: string };
      const text = (verbose.text ?? '').toString().trim();
      if (!text) {
        throw new TranscriptionInvalidInputError(
          'Whisper returned an empty transcript — audio may be silent or corrupt.',
        );
      }
      return {
        text,
        detectedLanguage: verbose.language,
        model: DEFAULT_MODEL,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): Error {
    if (err instanceof TranscriptionInvalidInputError) return err;
    if (err instanceof OpenAI.APIError) {
      const status = err.status ?? 0;
      this.logger.warn(`OpenAI Whisper error: status=${status} msg=${err.message}`);
      if (status === 401 || status === 403) return new TranscriptionAuthError(err.message);
      if (status === 429) return new TranscriptionRateLimitError(err.message);
      // 400 = bad audio file the SDK accepted but the model couldn't decode.
      if (status === 400) return new TranscriptionInvalidInputError(err.message);
      if (status >= 500 || status === 0) return new TranscriptionUnavailableError(err.message);
    }
    if (err instanceof Error) {
      this.logger.warn(`OpenAI SDK error: ${err.message}`);
      return new TranscriptionUnavailableError(err.message);
    }
    return new TranscriptionUnavailableError('Unknown Whisper error.');
  }
}
