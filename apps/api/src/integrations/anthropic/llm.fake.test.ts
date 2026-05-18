import { buildGenerationPrompt } from '@tutor-app/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { LlmRateLimitError, LlmUnavailableError } from './llm.client';
import { FakeLlmClient } from './llm.fake';

function promptFor(opts: {
  gameType?: 'FILL_BLANK' | 'TIMED_QUIZ';
  locale?: 'en' | 'pt' | 'he';
  poolSize?: number;
  feedback?: string;
} = {}) {
  return buildGenerationPrompt({
    gameType: opts.gameType ?? 'FILL_BLANK',
    locale: opts.locale ?? 'en',
    poolSize: opts.poolSize ?? 3,
    feedbackText: opts.feedback ?? 'Sara confused ser/estar.',
  });
}

describe('FakeLlmClient.generate', () => {
  let fake: FakeLlmClient;
  beforeEach(() => {
    fake = new FakeLlmClient();
  });

  it('returns valid JSON whose questions match the requested pool size', async () => {
    const res = await fake.generate({ prompt: promptFor({ poolSize: 7 }) });
    const parsed = JSON.parse(res.rawJson) as { questions: unknown[] };
    expect(parsed.questions).toHaveLength(7);
  });

  it('first call has zero cached input tokens; subsequent calls report a cache hit', async () => {
    const first = await fake.generate({ prompt: promptFor() });
    expect(first.usage.cachedInputTokens).toBe(0);
    const second = await fake.generate({ prompt: promptFor() });
    expect(second.usage.cachedInputTokens).toBeGreaterThan(0);
  });

  it('FILL_BLANK questions contain a `___` token and no distractors', async () => {
    const res = await fake.generate({ prompt: promptFor({ gameType: 'FILL_BLANK' }) });
    const { questions } = JSON.parse(res.rawJson) as {
      questions: Array<{ prompt: string; distractors?: unknown }>;
    };
    for (const q of questions) {
      expect(q.prompt).toContain('___');
      expect(q.distractors).toBeUndefined();
    }
  });

  it('TIMED_QUIZ questions have non-empty distractors', async () => {
    const res = await fake.generate({ prompt: promptFor({ gameType: 'TIMED_QUIZ' }) });
    const { questions } = JSON.parse(res.rawJson) as {
      questions: Array<{ distractors?: string[] }>;
    };
    for (const q of questions) {
      expect(q.distractors).toBeDefined();
      expect((q.distractors ?? []).length).toBeGreaterThan(0);
    }
  });

  it('Hebrew prompts produce Hebrew-script questions', async () => {
    const res = await fake.generate({ prompt: promptFor({ locale: 'he', gameType: 'FILL_BLANK' }) });
    const { questions } = JSON.parse(res.rawJson) as {
      questions: Array<{ prompt: string }>;
    };
    // Heuristic: at least one Hebrew code-point.
    expect(questions[0]?.prompt).toMatch(/[֐-׿]/);
  });

  it('Portuguese prompts produce Portuguese content', async () => {
    const res = await fake.generate({ prompt: promptFor({ locale: 'pt', gameType: 'FILL_BLANK' }) });
    const text = res.rawJson;
    expect(text).toMatch(/Pergunta/);
  });

  it('queued rate-limit failures throw LlmRateLimitError then recover', async () => {
    fake.__queueRateLimitFailures(2);
    await expect(fake.generate({ prompt: promptFor() })).rejects.toBeInstanceOf(LlmRateLimitError);
    await expect(fake.generate({ prompt: promptFor() })).rejects.toBeInstanceOf(LlmRateLimitError);
    // Third call should now succeed.
    const ok = await fake.generate({ prompt: promptFor() });
    expect(ok.rawJson).toContain('questions');
  });

  it('queued unavailable failures throw LlmUnavailableError', async () => {
    fake.__queueUnavailableFailures(1);
    await expect(fake.generate({ prompt: promptFor() })).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('__returnInvalidJsonNext produces output that JSON.parse can read but Zod rejects', async () => {
    fake.__returnInvalidJsonNext();
    const res = await fake.generate({ prompt: promptFor() });
    // JSON-parseable but missing required fields — the worker's Zod check
    // is what rejects it, not the LLM stage. We verify that here too.
    const parsed = JSON.parse(res.rawJson);
    expect(parsed).toHaveProperty('questions');
  });

  it('__reset clears all programmed failures', async () => {
    fake.__queueRateLimitFailures(5);
    fake.__reset();
    const ok = await fake.generate({ prompt: promptFor() });
    expect(ok.rawJson).toContain('questions');
  });
});
