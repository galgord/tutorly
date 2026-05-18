import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import {
  type LlmClient,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  LlmAuthError,
  LlmRateLimitError,
  LlmUnavailableError,
} from './llm.client';

// Default model for game generation. Sonnet is the spec choice for quality
// + cost; Phase 9 introduces a Haiku fallback when quota is near cap.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

/**
 * Real Anthropic-backed LlmClient.
 *
 * Important behaviors:
 *  - Passes `cache_control: { type: 'ephemeral' }` on the system block AND
 *    the gameType block — those are stable across calls in a session, so
 *    the second+ generation should report `cache_read_input_tokens > 0` in
 *    `usage` metadata (verified in the Phase 4 + Phase 9 cost-check gates).
 *  - Maps Anthropic SDK errors to the typed `LlmRateLimitError` /
 *    `LlmUnavailableError` / `LlmAuthError` so the caller doesn't depend on
 *    SDK internals.
 *  - Does NOT do its own retries — the games worker drives retry +
 *    circuit-breaker policy so the behavior is observable and tunable in
 *    one place.
 */
@Injectable()
export class RealAnthropicLlmClient implements LlmClient {
  private readonly logger = new Logger(RealAnthropicLlmClient.name);
  private readonly client: Anthropic;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('RealAnthropicLlmClient requires ANTHROPIC_API_KEY.');
    }
    this.client = new Anthropic({ apiKey });
  }

  async generate(req: LlmGenerationRequest): Promise<LlmGenerationResult> {
    const model = req.model ?? DEFAULT_MODEL;
    const maxTokens = req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        // Two cached blocks: a stable system prompt + a per-(gameType,locale)
        // instruction block. Anthropic dedupes by block content + cache_control
        // marker, so the second call with the same (system, gameTypeBlock)
        // returns cache hits in `usage.cache_read_input_tokens`.
        system: [
          {
            type: 'text',
            text: req.prompt.system,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: req.prompt.gameTypeBlock,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: req.prompt.userMessage }],
          },
        ],
      });

      // Concatenate all text content blocks. We asked for raw JSON, so this
      // SHOULD be exactly one block. Be defensive in case the model surrounds
      // it with anything.
      const rawJson = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      const usageRaw = res.usage as {
        input_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        output_tokens?: number;
      };

      return {
        rawJson,
        model: res.model,
        usage: {
          inputTokens: usageRaw.input_tokens ?? 0,
          cachedInputTokens: usageRaw.cache_read_input_tokens ?? 0,
          outputTokens: usageRaw.output_tokens ?? 0,
        },
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): Error {
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 0;
      this.logger.warn(`Anthropic API error: status=${status} msg=${err.message}`);
      if (status === 401 || status === 403) return new LlmAuthError(err.message);
      if (status === 429) return new LlmRateLimitError(err.message);
      if (status >= 500 || status === 0) return new LlmUnavailableError(err.message);
    }
    if (err instanceof Error) {
      this.logger.warn(`Anthropic SDK error: ${err.message}`);
      return new LlmUnavailableError(err.message);
    }
    return new LlmUnavailableError('Unknown LLM error.');
  }
}
