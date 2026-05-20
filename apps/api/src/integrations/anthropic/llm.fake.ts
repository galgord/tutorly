import { Injectable, Logger } from '@nestjs/common';
import { PROMPT_FEEDBACK_DELIMITERS } from '@tutor-app/shared';
import {
  type LlmClient,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  LlmRateLimitError,
  LlmUnavailableError,
} from './llm.client';

/**
 * Programmable in-memory fake of LlmClient.
 *
 * Defaults: returns a deterministic pool whose size matches the request
 * (parsed out of the gameTypeBlock — `Generate exactly N questions.`).
 *
 * Tests + the Playwright E2E lean on this so the full game-gen flow can
 * exercise without burning Anthropic credit. Programmable failure modes
 * exist for retry + circuit-breaker tests.
 *
 * State is module-scoped (single instance per process); tests should call
 * __reset() in beforeEach when they programmed failures.
 */
@Injectable()
export class FakeLlmClient implements LlmClient {
  private readonly logger = new Logger(FakeLlmClient.name);

  private failuresQueued = 0;
  private failureKind: 'rate_limit' | 'unavailable' | 'invalid_json' | null = null;
  private invalidJsonOnce = false;
  private callCount = 0;

  async generate(req: LlmGenerationRequest): Promise<LlmGenerationResult> {
    this.callCount += 1;

    // Pop a programmed failure if one is queued.
    if (this.failuresQueued > 0 && this.failureKind !== null) {
      this.failuresQueued -= 1;
      const kind = this.failureKind;
      if (this.failuresQueued === 0) this.failureKind = null;
      if (kind === 'rate_limit') throw new LlmRateLimitError();
      if (kind === 'unavailable') throw new LlmUnavailableError();
      // 'invalid_json' falls through and returns a junk string so we can
      // test the Zod validation path. We don't throw here.
      return {
        rawJson: 'not a json object at all',
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 5 },
        model: 'claude-fake-invalid',
      };
    }
    if (this.invalidJsonOnce) {
      this.invalidJsonOnce = false;
      return {
        rawJson: '{ "questions": [ { "prompt": "missing answer field" } ] }',
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 },
        model: 'claude-fake-invalid',
      };
    }

    // Pool size is embedded in the gameTypeBlock (see prompts/index.ts).
    const poolMatch = req.prompt.gameTypeBlock.match(/exactly (\d+) questions/);
    const poolSize = poolMatch ? Math.min(50, parseInt(poolMatch[1]!, 10)) : 3;
    const isFillBlank = req.prompt.gameTypeBlock.includes('FILL_BLANK');
    const isHebrew = req.prompt.gameTypeBlock.includes('Modern Hebrew');
    const isPortuguese = req.prompt.gameTypeBlock.includes('Brazilian Portuguese');

    // Pull the first 60 chars of feedback so generated content "looks
    // related" in agent-browser screenshots. We strip the wrapper delimiters.
    const feedbackBody = req.prompt.userMessage
      .split(PROMPT_FEEDBACK_DELIMITERS.open)[1]
      ?.split(PROMPT_FEEDBACK_DELIMITERS.close)[0]
      ?.trim() ?? '';
    const seed = feedbackBody.slice(0, 60) || 'practice topic';

    // Top-up requests carry an avoid-list block; offset the question index so
    // generated prompts differ from the existing pool (mirrors a real model
    // honoring the "produce genuinely new questions" instruction).
    const isTopUp = req.prompt.userMessage.includes('EXISTING_ITEMS_START');
    const idxOffset = isTopUp ? this.callCount * 1000 : 0;

    const questions: unknown[] = [];
    for (let i = 0; i < poolSize; i++) {
      questions.push(
        this.makeQuestion(idxOffset + i + 1, seed, { isFillBlank, isHebrew, isPortuguese }),
      );
    }

    const payload = JSON.stringify({ questions });
    return {
      rawJson: payload,
      usage: {
        inputTokens: 1_200,
        // After the first call within a session, simulate prompt-cache hits.
        cachedInputTokens: this.callCount > 1 ? 900 : 0,
        outputTokens: questions.length * 30,
      },
      model: 'claude-fake',
    };
  }

  private makeQuestion(
    idx: number,
    seed: string,
    flags: { isFillBlank: boolean; isHebrew: boolean; isPortuguese: boolean },
  ): unknown {
    const tag = `topic-${idx % 3}`;
    // Cycle 1..5 so any pool of ≥5 questions provably spans every difficulty
    // tier — the adaptive engine (Phase 12) and its E2E rely on this.
    const difficulty = ((idx - 1) % 5) + 1;
    if (flags.isFillBlank) {
      if (flags.isHebrew) {
        return {
          prompt: `שאלה ${idx}: ___ הוא הפועל הנכון. (${seed})`,
          answer: 'הולך',
          acceptAlternates: [],
          topicTags: [tag, 'present-tense'],
          difficulty,
        };
      }
      if (flags.isPortuguese) {
        return {
          prompt: `Pergunta ${idx}: O cachorro ___ rapidamente. (${seed})`,
          answer: 'corre',
          acceptAlternates: ['correu'],
          topicTags: [tag, 'verbos'],
          difficulty,
        };
      }
      return {
        prompt: `Question ${idx}: She ___ to school every morning. (${seed})`,
        answer: 'walks',
        acceptAlternates: ['walked'],
        topicTags: [tag, 'present-tense'],
        difficulty,
      };
    }
    // TIMED_QUIZ — multiple choice
    if (flags.isHebrew) {
      return {
        prompt: `שאלה ${idx}: מה משמעות "ספר"? (${seed})`,
        answer: 'book',
        distractors: ['table', 'window', 'chair'],
        topicTags: [tag, 'vocabulary'],
        difficulty,
      };
    }
    if (flags.isPortuguese) {
      return {
        prompt: `Pergunta ${idx}: Qual é o passado de "ir"? (${seed})`,
        answer: 'fui',
        distractors: ['vou', 'irei', 'indo'],
        topicTags: [tag, 'verbos'],
        difficulty,
      };
    }
    return {
      prompt: `Question ${idx}: What is the past tense of "go"? (${seed})`,
      answer: 'went',
      distractors: ['goed', 'gone', 'going'],
      topicTags: [tag, 'verbs'],
      difficulty,
    };
  }

  // ---- Test-only setters -----------------------------------------------

  __reset(): void {
    this.failuresQueued = 0;
    this.failureKind = null;
    this.invalidJsonOnce = false;
    this.callCount = 0;
  }

  __queueRateLimitFailures(count: number): void {
    this.failuresQueued = count;
    this.failureKind = 'rate_limit';
  }

  __queueUnavailableFailures(count: number): void {
    this.failuresQueued = count;
    this.failureKind = 'unavailable';
  }

  /** Returns a malformed JSON string on the next call, then a real pool. */
  __returnInvalidJsonNext(): void {
    this.invalidJsonOnce = true;
  }

  __callCount(): number {
    return this.callCount;
  }
}
