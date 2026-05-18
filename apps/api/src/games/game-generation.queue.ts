import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GameStatus, GameType, type Game, type Prisma } from '@prisma/client';
import {
  LlmGenerationResponseSchema,
  buildGenerationPrompt,
  type GameQuestion,
  type Locale,
} from '@tutor-app/shared';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '../config/config.service';
import {
  LLM_CLIENT,
  type LlmClient,
  LlmAuthError,
  LlmInvalidOutputError,
  LlmRateLimitError,
  LlmUnavailableError,
} from '../integrations/anthropic/llm.client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 4 game-generation queue.
 *
 * Design call: this is an **in-process** queue (no Redis dep beyond what
 * Phase 5/Whisper will add). It implements the policies the spec requires —
 *   - bounded retries with exponential backoff
 *   - per-process circuit breaker (open 60s after N consecutive failures)
 *   - tutor-visible terminal state (Game.status = FAILED + generationError)
 *
 * BullMQ-backed durability lands with Phase 5 (it'll share the worker
 * pattern); the public surface — `enqueue`, `processGeneration`, `drain` —
 * stays identical so swapping backends is a contained change.
 *
 * Recovery on restart: any Game stuck in GENERATING older than ~30s on boot
 * is reset to FAILED (`onModuleInit`), so a crash during processing doesn't
 * leave a tutor staring at a permanent "generating" UI.
 */
@Injectable()
export class GameGenerationQueue implements OnModuleInit {
  private readonly logger = new Logger(GameGenerationQueue.name);

  // Track all currently-running job promises so tests (and graceful
  // shutdown) can `await queue.drain()`.
  private readonly inFlight = new Map<string, Promise<void>>();

  // Circuit breaker — process-wide. Counts consecutive terminal failures.
  private consecutiveFailures = 0;
  private breakerOpenUntilMs = 0;

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Sweep stuck GENERATING rows from a previous process. 30s grace because
    // a job that's actively running on startup must have started before
    // this process — leaving it as GENERATING would be a lie.
    const cutoff = new Date(Date.now() - 30_000);
    try {
      const result = await this.prisma.game.updateMany({
        where: { status: GameStatus.GENERATING, updatedAt: { lt: cutoff } },
        data: {
          status: GameStatus.FAILED,
          generationError: 'GENERATION_INTERRUPTED',
        },
      });
      if (result.count > 0) {
        this.logger.warn(`Recovered ${result.count} stuck GENERATING game(s) → FAILED.`);
      }
    } catch (err) {
      // Tests run without a DB sometimes; don't crash the module init.
      this.logger.debug(`Stuck-job sweep skipped: ${(err as Error).message}`);
    }
  }

  // ---- Public surface ---------------------------------------------------

  /**
   * Schedule generation for the given game id. Returns immediately; the
   * worker runs on the event loop. If the circuit breaker is open, the
   * game is marked FAILED synchronously and the caller can surface that
   * via the 202 response body.
   */
  enqueue(gameId: string): { accepted: boolean; breakerOpen: boolean } {
    if (this.isBreakerOpen()) {
      // Don't even start; flip the game to FAILED so the UI shows the
      // banner immediately on the next poll.
      void this.markBreakerFailure(gameId);
      return { accepted: false, breakerOpen: true };
    }
    // Microtask scheduling — the controller's 202 returns first, then the
    // worker picks up the job. `setImmediate` keeps the response snappy
    // even when many jobs land simultaneously.
    const promise = (async () => {
      // Yield once so the controller's response is flushed first.
      await new Promise<void>((r) => setImmediate(r));
      await this.processGeneration(gameId);
    })()
      .catch((err) => {
        // processGeneration should swallow everything, but defense in depth.
        this.logger.error(
          `unexpected uncaught error processing ${gameId}: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.inFlight.delete(gameId);
      });
    this.inFlight.set(gameId, promise);
    return { accepted: true, breakerOpen: false };
  }

  /** Wait for all currently-running jobs to settle. Used in tests. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(Array.from(this.inFlight.values()));
    }
  }

  /**
   * Regenerate a single question synchronously (the tutor is staring at
   * the review modal). Bypasses the retry+breaker pipeline because:
   *   - the failure is surfaced inline; the tutor can click again
   *   - we still want the same prompt builder + Zod validation
   * Returns null when generation fails so the caller can show "try again".
   */
  async regenerateSingle(opts: {
    gameId: string;
    gameType: GameType;
    locale: Locale;
  }): Promise<GameQuestion | null> {
    if (this.isBreakerOpen()) return null;
    const game = await this.loadGame(opts.gameId);
    if (!game || !game.lesson?.feedbackText) return null;

    const prompt = buildGenerationPrompt({
      gameType: opts.gameType === GameType.FILL_BLANK ? 'FILL_BLANK' : 'TIMED_QUIZ',
      locale: opts.locale,
      // Ask for 1 question; the model often over-shoots so we keep just the first.
      poolSize: 1,
      feedbackText: game.lesson.feedbackText,
    });

    try {
      const result = await this.llm.generate({ prompt });
      const parsed = LlmGenerationResponseSchema.safeParse(JSON.parse(result.rawJson));
      if (!parsed.success || parsed.data.questions.length === 0) return null;
      return normalizeQuestion(parsed.data.questions[0]!, opts.gameType);
    } catch (err) {
      this.logger.warn(`regenerateSingle(${opts.gameId}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  isBreakerOpen(): boolean {
    return Date.now() < this.breakerOpenUntilMs;
  }

  /**
   * Pure-state breaker snapshot — used by admin/health endpoints. Not part
   * of the worker hot path.
   */
  snapshot(): {
    inFlight: number;
    breakerOpen: boolean;
    consecutiveFailures: number;
    breakerOpenUntilMs: number;
  } {
    return {
      inFlight: this.inFlight.size,
      breakerOpen: this.isBreakerOpen(),
      consecutiveFailures: this.consecutiveFailures,
      breakerOpenUntilMs: this.breakerOpenUntilMs,
    };
  }

  // ---- Worker core ------------------------------------------------------

  /**
   * Run a generation attempt for a single game. Handles retries + breaker
   * accounting internally. Always settles by writing a terminal status
   * (DRAFT on success, FAILED on terminal failure) so the tutor's UI never
   * gets stuck in GENERATING.
   */
  async processGeneration(gameId: string): Promise<void> {
    const game = await this.loadGame(gameId);
    if (!game) {
      this.logger.warn(`processGeneration(${gameId}): game vanished`);
      return;
    }
    if (game.status !== GameStatus.GENERATING) {
      // Idempotency: someone already completed it (manual edit, second
      // worker, etc). Don't clobber.
      return;
    }

    const maxRetries = this.config.get('GAME_GEN_MAX_RETRIES');
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      attempt += 1;
      try {
        const questions = await this.attemptOnce(game);
        await this.persistSuccess(game.id, questions);
        // Successful call → close the breaker.
        this.consecutiveFailures = 0;
        return;
      } catch (err) {
        lastError = err as Error;
        const retryable = this.isRetryable(err);
        this.logger.warn(
          `gen[${game.id}] attempt ${attempt}/${maxRetries + 1} failed (retryable=${retryable}): ${lastError.message}`,
        );
        if (!retryable || attempt > maxRetries) break;
        // Exponential backoff: 250ms, 750ms, 2250ms. Quick enough that the
        // tutor's poll-loop typically catches the final state in 3-4 polls.
        const delay = 250 * Math.pow(3, attempt - 1);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }

    // Exhausted retries — terminal failure.
    this.consecutiveFailures += 1;
    const threshold = this.config.get('GAME_GEN_BREAKER_THRESHOLD');
    if (this.consecutiveFailures >= threshold) {
      const resetMs = this.config.get('GAME_GEN_BREAKER_RESET_MS');
      this.breakerOpenUntilMs = Date.now() + resetMs;
      this.logger.error(
        `circuit breaker OPEN for ${resetMs}ms after ${this.consecutiveFailures} consecutive failures`,
      );
    }
    await this.persistFailure(game.id, classifyError(lastError));
  }

  // ---- Internals --------------------------------------------------------

  private async loadGame(gameId: string): Promise<
    | (Game & {
        lesson: { feedbackText: string | null; student: { tutorId: string } } | null;
      })
    | null
  > {
    return this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        lesson: {
          select: {
            feedbackText: true,
            student: { select: { tutorId: true } },
          },
        },
      },
    });
  }

  private async attemptOnce(
    game: Game & {
      lesson: { feedbackText: string | null; student: { tutorId: string } } | null;
    },
  ): Promise<GameQuestion[]> {
    const feedback = (game.lesson?.feedbackText ?? '').trim();
    if (!feedback) throw new Error('Game lesson has no feedback to generate from.');

    const prompt = buildGenerationPrompt({
      gameType: game.type === GameType.FILL_BLANK ? 'FILL_BLANK' : 'TIMED_QUIZ',
      locale: (game.locale as Locale) ?? 'en',
      poolSize: game.poolSize,
      feedbackText: feedback,
    });

    const result = await this.llm.generate({ prompt });

    // Parse + strict-validate. Any deviation → retry (treated as retryable
    // because the model may produce valid output on the next attempt).
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(result.rawJson);
    } catch {
      throw new LlmInvalidOutputError('LLM returned non-JSON output.');
    }
    const validated = LlmGenerationResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new LlmInvalidOutputError(
        `LLM output failed schema validation: ${validated.error.issues
          .slice(0, 2)
          .map((i) => i.message)
          .join('; ')}`,
      );
    }

    // Normalize topic tags + assign stable server-side ids.
    return validated.data.questions.map((q) => normalizeQuestion(q, game.type));
  }

  private async persistSuccess(gameId: string, questions: GameQuestion[]): Promise<void> {
    await this.prisma.game.update({
      where: { id: gameId },
      data: {
        status: GameStatus.DRAFT,
        questionPool: questions as unknown as Prisma.InputJsonValue,
        generationError: null,
      },
    });
  }

  private async persistFailure(gameId: string, reason: string): Promise<void> {
    await this.prisma.game.update({
      where: { id: gameId },
      data: { status: GameStatus.FAILED, generationError: reason },
    });
  }

  private async markBreakerFailure(gameId: string): Promise<void> {
    try {
      await this.persistFailure(gameId, 'AI_UNAVAILABLE_CIRCUIT_OPEN');
    } catch (err) {
      this.logger.error(`failed to mark game ${gameId} FAILED on breaker open: ${(err as Error).message}`);
    }
  }

  private isRetryable(err: unknown): boolean {
    // Non-retryable: auth failures (won't fix by retrying), schema mismatches
    // up to a point (we still let it retry once or twice in case of LLM
    // flakiness — see attempt loop above; the cap stops infinite loops).
    if (err instanceof LlmAuthError) return false;
    if (
      err instanceof LlmRateLimitError ||
      err instanceof LlmUnavailableError ||
      err instanceof LlmInvalidOutputError
    ) {
      return true;
    }
    // Unknown errors → retry once (the cap stops more).
    return true;
  }
}

function normalizeQuestion(
  q: {
    prompt: string;
    answer: string;
    distractors?: string[];
    acceptAlternates?: string[];
    topicTags: string[];
  },
  gameType: GameType,
): GameQuestion {
  // Normalize tags: lowercased, trimmed, deduped, max 5.
  const tags = Array.from(
    new Set(q.topicTags.map((t) => t.toLowerCase().trim()).filter(Boolean)),
  ).slice(0, 5);

  const id = `q_${randomBytes(8).toString('hex')}`;
  // For fill-blank, drop any accidental distractors. For timed-quiz, ensure
  // a non-empty distractors array (otherwise the question is unplayable).
  if (gameType === GameType.FILL_BLANK) {
    return {
      id,
      prompt: q.prompt.trim(),
      answer: q.answer.trim(),
      distractors: [],
      acceptAlternates: (q.acceptAlternates ?? []).map((s) => s.trim()).filter(Boolean),
      topicTags: tags,
    };
  }
  return {
    id,
    prompt: q.prompt.trim(),
    answer: q.answer.trim(),
    distractors: (q.distractors ?? []).map((s) => s.trim()).filter(Boolean),
    acceptAlternates: (q.acceptAlternates ?? []).map((s) => s.trim()).filter(Boolean),
    topicTags: tags,
  };
}

function classifyError(err: Error | null): string {
  if (!err) return 'UNKNOWN';
  if (err instanceof LlmRateLimitError) return 'RATE_LIMITED';
  if (err instanceof LlmUnavailableError) return 'AI_UNAVAILABLE';
  if (err instanceof LlmInvalidOutputError) return 'INVALID_OUTPUT';
  if (err instanceof LlmAuthError) return 'AUTH_FAILED';
  return 'UNKNOWN';
}
