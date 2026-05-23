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
// A 30-question TIMED_QUIZ pool with translations + distractors approaches
// 6k output tokens. 8192 gives headroom without changing cost on small pools
// (we pay only for what's emitted).
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

// Forced tool-use is Anthropic's guaranteed-structured-output path: the model
// MUST call this tool. The schema mirrors LlmQuestionSchema in shared so the
// model produces exactly the fields the downstream Zod parser requires.
// FILL_BLANK -> include "___" in `prompt`, leave `distractors` empty.
// TIMED_QUIZ  -> include 3 `distractors` (server enforces ≥3 on persist).
/**
 * Tolerate the most common shape drifts a model may emit when calling
 * `submit_questions`. Zod still has the final say on the per-question shape;
 * this only resolves the envelope so a one-character variance doesn't dead
 * the whole generation.
 */
export function normalizeQuestionsEnvelope(input: unknown): { questions: unknown[] } {
  if (Array.isArray(input)) return { questions: input };
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.questions)) return { questions: obj.questions };
    if ('question' in obj && !('questions' in obj)) {
      const q = obj.question;
      return { questions: Array.isArray(q) ? q : [q] };
    }
  }
  // Pass through; Zod will reject and the diagnostic log in the queue will
  // surface the actual shape the model emitted.
  return input as { questions: unknown[] };
}

const SUBMIT_TOOL = {
  name: 'submit_questions',
  description:
    'Submit the generated practice questions. Each question MUST have a non-empty `prompt` and `answer`. For TIMED_QUIZ, include exactly 3 `distractors`. For FILL_BLANK, the `prompt` must contain "___" where the answer goes; leave `distractors` empty.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string', minLength: 1 },
            answer: { type: 'string', minLength: 1 },
            promptTranslation: { type: ['string', 'null'] },
            distractors: { type: 'array', items: { type: 'string', minLength: 1 } },
            acceptAlternates: { type: 'array', items: { type: 'string', minLength: 1 } },
            topicTags: { type: 'array', items: { type: 'string', minLength: 1 } },
            difficulty: { type: 'integer', minimum: 1, maximum: 5 },
          },
          required: ['prompt', 'answer'],
        },
      },
    },
    required: ['questions'],
  },
};

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
        tools: [SUBMIT_TOOL],
        // Force the model to call submit_questions — guarantees JSON output.
        tool_choice: { type: 'tool', name: SUBMIT_TOOL.name },
      });

      // With forced tool_choice the model MUST emit exactly one tool_use block.
      const toolUse = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (!toolUse) {
        throw new LlmUnavailableError(
          `Model did not call the submit_questions tool (stop_reason=${res.stop_reason ?? 'unknown'}).`,
        );
      }
      // Surface stop_reason so a `max_tokens` truncation looks distinct from a
      // model-shape drift in the logs.
      this.logger.debug(
        `Anthropic response: stop_reason=${res.stop_reason ?? 'unknown'} output_tokens=${res.usage?.output_tokens ?? '?'}`,
      );
      const rawJson = JSON.stringify(normalizeQuestionsEnvelope(toolUse.input));

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
