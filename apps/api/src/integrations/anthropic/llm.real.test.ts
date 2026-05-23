import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../../config/config.service';
import {
  LlmAuthError,
  LlmRateLimitError,
  LlmUnavailableError,
} from './llm.client';
import { RealAnthropicLlmClient, normalizeQuestionsEnvelope } from './llm.real';

// Shared mock state for the SDK. `vi.hoisted` lets us reference these from
// both the `vi.mock` factory (which runs before imports) and the test body.
const { messagesCreate, MockAPIError } = vi.hoisted(() => {
  const messagesCreate = vi.fn();
  class MockAPIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { messagesCreate, MockAPIError };
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate };
    constructor(_opts: { apiKey: string }) {}
    static APIError = MockAPIError;
  }
  return { default: MockAnthropic };
});

function makeClient(): RealAnthropicLlmClient {
  const config = {
    get: (key: string) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : undefined),
  } as unknown as ConfigService;
  return new RealAnthropicLlmClient(config);
}

const sampleQuestion = {
  prompt: 'Eu ___ português.',
  answer: 'falo',
  topicTags: ['falar', 'presente'],
  difficulty: 1,
};

const fakePrompt = {
  system: 'sys',
  gameTypeBlock: 'gameType',
  userMessage: 'user',
  cacheKey: 'key',
};

beforeEach(() => {
  messagesCreate.mockReset();
});

describe('normalizeQuestionsEnvelope', () => {
  it('passes through the canonical envelope', () => {
    expect(normalizeQuestionsEnvelope({ questions: [sampleQuestion] })).toEqual({
      questions: [sampleQuestion],
    });
  });

  it('wraps a bare array', () => {
    expect(normalizeQuestionsEnvelope([sampleQuestion])).toEqual({
      questions: [sampleQuestion],
    });
  });

  it('wraps a singular `question` object', () => {
    expect(normalizeQuestionsEnvelope({ question: sampleQuestion })).toEqual({
      questions: [sampleQuestion],
    });
  });

  it('wraps a singular `question` array', () => {
    expect(normalizeQuestionsEnvelope({ question: [sampleQuestion] })).toEqual({
      questions: [sampleQuestion],
    });
  });

  it('passes through unrecognized shapes (Zod owns the strict check)', () => {
    expect(normalizeQuestionsEnvelope({ items: [sampleQuestion] })).toEqual({
      items: [sampleQuestion],
    });
  });
});

describe('RealAnthropicLlmClient', () => {
  it('forces tool_choice on submit_questions and returns the tool input as JSON', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'submit_questions',
          input: { questions: [sampleQuestion] },
        },
      ],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    });

    const out = await makeClient().generate({ prompt: fakePrompt });

    const call = messagesCreate.mock.calls[0]![0] as {
      tools: { name: string }[];
      tool_choice: { type: string; name: string };
    };
    expect(call.tools[0]!.name).toBe('submit_questions');
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'submit_questions' });
    expect(JSON.parse(out.rawJson)).toEqual({ questions: [sampleQuestion] });
  });

  it('normalizes a bare-array tool input into the envelope', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', name: 'submit_questions', input: [sampleQuestion] },
      ],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const out = await makeClient().generate({ prompt: fakePrompt });
    expect(JSON.parse(out.rawJson)).toEqual({ questions: [sampleQuestion] });
  });

  it('normalizes a singular `question` tool input into the envelope', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'submit_questions',
          input: { question: sampleQuestion },
        },
      ],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const out = await makeClient().generate({ prompt: fakePrompt });
    expect(JSON.parse(out.rawJson)).toEqual({ questions: [sampleQuestion] });
  });

  it('throws LlmUnavailableError if the model returns no tool_use block', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'oops' }],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    await expect(makeClient().generate({ prompt: fakePrompt })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });

  it('maps SDK 401 → LlmAuthError', async () => {
    messagesCreate.mockRejectedValueOnce(new MockAPIError('forbidden', 401));
    await expect(makeClient().generate({ prompt: fakePrompt })).rejects.toBeInstanceOf(
      LlmAuthError,
    );
  });

  it('maps SDK 429 → LlmRateLimitError', async () => {
    messagesCreate.mockRejectedValueOnce(new MockAPIError('too many', 429));
    await expect(makeClient().generate({ prompt: fakePrompt })).rejects.toBeInstanceOf(
      LlmRateLimitError,
    );
  });

  it('maps SDK 5xx → LlmUnavailableError', async () => {
    messagesCreate.mockRejectedValueOnce(new MockAPIError('boom', 503));
    await expect(makeClient().generate({ prompt: fakePrompt })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });
});
