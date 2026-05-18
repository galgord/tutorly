import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { FeedbackSource, TranscriptionStatus, type Lesson } from '@prisma/client';
import type { Locale } from '@tutor-app/shared';
import { ConfigService } from '../config/config.service';
import {
  TRANSCRIBER_CLIENT,
  type TranscriberClient,
  TranscriptionAuthError,
  TranscriptionInvalidInputError,
  TranscriptionRateLimitError,
  TranscriptionUnavailableError,
} from '../integrations/openai/whisper.client';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { AudioStorageService } from './audio-storage.service';

/**
 * Phase 5 Whisper transcription queue.
 *
 * Same shape as `GameGenerationQueue` (Phase 4) so the eventual BullMQ
 * swap is a single contained change:
 *   - bounded retries with exponential backoff
 *   - per-process circuit breaker (open 60s after N consecutive failures)
 *   - tutor-visible terminal state via Lesson.transcriptionStatus = FAILED
 *
 * Recovery on restart: any Lesson stuck in TRANSCRIBING older than ~30s
 * on boot is reset to FAILED (`onModuleInit`).
 *
 * Public surface (mirrors GameGenerationQueue):
 *   - enqueue
 *   - drain                (tests + graceful shutdown)
 *   - processTranscription (worker core)
 *   - snapshot             (admin/health)
 */
@Injectable()
export class WhisperJobQueue implements OnModuleInit {
  private readonly logger = new Logger(WhisperJobQueue.name);

  private readonly inFlight = new Map<string, Promise<void>>();
  // Side-table of (tutorId, minutes) per in-flight job so we know who to
  // refund — and how much — when a job hits terminal FAILED.
  private readonly refundByJob = new Map<string, { tutorId: string; minutes: number }>();

  private consecutiveFailures = 0;
  private breakerOpenUntilMs = 0;

  constructor(
    @Inject(TRANSCRIBER_CLIENT) private readonly transcriber: TranscriberClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: AudioStorageService,
    @Optional() private readonly quota?: QuotaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const cutoff = new Date(Date.now() - 30_000);
    try {
      const result = await this.prisma.lesson.updateMany({
        where: { transcriptionStatus: TranscriptionStatus.TRANSCRIBING, updatedAt: { lt: cutoff } },
        data: {
          transcriptionStatus: TranscriptionStatus.FAILED,
          transcriptionError: 'TRANSCRIPTION_INTERRUPTED',
        },
      });
      if (result.count > 0) {
        this.logger.warn(`Recovered ${result.count} stuck TRANSCRIBING lesson(s) → FAILED.`);
      }
    } catch (err) {
      this.logger.debug(`Stuck-job sweep skipped: ${(err as Error).message}`);
    }
  }

  // ---- Public surface ---------------------------------------------------

  /**
   * Schedule transcription for the given lesson id. Returns immediately;
   * the worker runs on the event loop. If the breaker is open, the lesson
   * is marked FAILED synchronously so the UI surfaces the banner on its
   * next poll.
   *
   * `tutorId` + `minutes` are remembered on the side-table so that a
   * terminal FAILED can refund the slot reserved at the controller layer.
   */
  enqueue(
    lessonId: string,
    opts: { tutorId: string; minutes: number; locale: Locale },
  ): { accepted: boolean; breakerOpen: boolean } {
    this.refundByJob.set(lessonId, { tutorId: opts.tutorId, minutes: opts.minutes });
    if (this.isBreakerOpen()) {
      void this.markBreakerFailure(lessonId);
      this.refundByJob.delete(lessonId);
      return { accepted: false, breakerOpen: true };
    }
    const promise = (async () => {
      await new Promise<void>((r) => setImmediate(r));
      await this.processTranscription(lessonId, opts.locale);
    })()
      .catch((err) => {
        this.logger.error(
          `unexpected uncaught error processing ${lessonId}: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.inFlight.delete(lessonId);
        this.refundByJob.delete(lessonId);
      });
    this.inFlight.set(lessonId, promise);
    return { accepted: true, breakerOpen: false };
  }

  /** Wait for all currently-running jobs to settle. Used in tests. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(Array.from(this.inFlight.values()));
    }
  }

  isBreakerOpen(): boolean {
    return Date.now() < this.breakerOpenUntilMs;
  }

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
   * Run a transcription attempt for a single lesson. Handles retries +
   * breaker accounting. Always settles by writing a terminal status
   * (DONE on success, FAILED on terminal failure) and — on success —
   * deleting the audio file from disk (spec: audio retention = 0).
   *
   * The transcript text is written into `Lesson.feedbackText` as a
   * SUGGESTION; the tutor must still click "Save" in the existing
   * FeedbackEditor before the lesson's `feedbackSource` flips to VOICE.
   * That gating is enforced by the controller, not here.
   */
  async processTranscription(lessonId: string, locale: Locale): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) {
      this.logger.warn(`processTranscription(${lessonId}): lesson vanished`);
      return;
    }
    if (lesson.transcriptionStatus !== TranscriptionStatus.PENDING) {
      // Idempotency: another worker / manual edit already moved it on.
      return;
    }
    if (!lesson.audioUrl) {
      await this.persistFailure(lessonId, 'NO_AUDIO');
      return;
    }

    // Flip to TRANSCRIBING so the UI shows progress (the stuck-job
    // recovery on next boot uses this state + updatedAt).
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { transcriptionStatus: TranscriptionStatus.TRANSCRIBING },
    });

    const maxRetries = this.config.get('WHISPER_MAX_RETRIES');
    let attempt = 0;
    let lastError: Error | null = null;
    let result: { text: string; detectedLanguage?: string } | null = null;

    while (attempt <= maxRetries) {
      attempt += 1;
      try {
        const audioPath = this.storage.absolutePath(lesson.audioUrl);
        const r = await this.transcriber.transcribe({
          audioPath,
          locale,
          // We don't store duration in the schema; the side-table has
          // the minutes value but the per-second is only used for logs.
          durationSeconds: (this.refundByJob.get(lessonId)?.minutes ?? 1) * 60,
        });
        result = { text: r.text, detectedLanguage: r.detectedLanguage };
        this.consecutiveFailures = 0;
        break;
      } catch (err) {
        lastError = err as Error;
        const retryable = this.isRetryable(err);
        this.logger.warn(
          `whisper[${lessonId}] attempt ${attempt}/${maxRetries + 1} failed (retryable=${retryable}): ${lastError.message}`,
        );
        if (!retryable || attempt > maxRetries) break;
        const delay = 250 * Math.pow(3, attempt - 1);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }

    if (result) {
      await this.persistSuccess(lesson, result.text);
      return;
    }

    // Terminal failure path.
    this.consecutiveFailures += 1;
    const threshold = this.config.get('WHISPER_BREAKER_THRESHOLD');
    if (this.consecutiveFailures >= threshold) {
      const resetMs = this.config.get('WHISPER_BREAKER_RESET_MS');
      this.breakerOpenUntilMs = Date.now() + resetMs;
      this.logger.error(
        `whisper circuit breaker OPEN for ${resetMs}ms after ${this.consecutiveFailures} consecutive failures`,
      );
    }
    await this.persistFailure(lessonId, classifyError(lastError));
    // Refund the tutor's minutes — failures we caused shouldn't burn cap.
    const refund = this.refundByJob.get(lessonId);
    if (refund && this.quota) {
      await this.quota.refundWhisperMinutes(refund.tutorId, refund.minutes);
    }
    // Best-effort cleanup of the on-disk audio even on failure — the
    // tutor can re-upload if they want to retry; we don't want stale
    // files sitting around indefinitely.
    if (lesson.audioUrl) {
      await this.storage.delete(lesson.audioUrl);
      await this.prisma.lesson.update({
        where: { id: lessonId },
        data: { audioUrl: null },
      });
    }
  }

  // ---- Internals --------------------------------------------------------

  /**
   * Successful transcription: populate `feedbackText` as a SUGGESTION
   * (the tutor still needs to click Save) and flip status to DONE. We
   * intentionally DO NOT set `feedbackSource = VOICE` here — that lands
   * in the lesson controller's setFeedback when the tutor saves, mirroring
   * the existing Phase 4 flow.
   *
   * Delete the audio file post-transcription per the spec's retention
   * rule, and NULL the lesson's audioUrl in the same transaction so a
   * crash between the two doesn't leave a dangling pointer.
   */
  private async persistSuccess(lesson: Lesson, transcript: string): Promise<void> {
    await this.prisma.lesson.update({
      where: { id: lesson.id },
      data: {
        feedbackText: transcript,
        // Mark the existing source TEXT-or-VOICE history conservatively:
        // tutor still has to explicitly save before it becomes VOICE. We
        // leave the field at its current value here.
        transcriptionStatus: TranscriptionStatus.DONE,
        transcriptionError: null,
        audioUrl: null,
      },
    });
    if (lesson.audioUrl) {
      await this.storage.delete(lesson.audioUrl);
    }
  }

  private async persistFailure(lessonId: string, reason: string): Promise<void> {
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        transcriptionStatus: TranscriptionStatus.FAILED,
        transcriptionError: reason,
      },
    });
  }

  private async markBreakerFailure(lessonId: string): Promise<void> {
    try {
      await this.persistFailure(lessonId, 'WHISPER_UNAVAILABLE_CIRCUIT_OPEN');
      const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
      if (lesson?.audioUrl) {
        await this.storage.delete(lesson.audioUrl);
        await this.prisma.lesson.update({
          where: { id: lessonId },
          data: { audioUrl: null },
        });
      }
    } catch (err) {
      this.logger.error(
        `failed to mark lesson ${lessonId} FAILED on breaker open: ${(err as Error).message}`,
      );
    }
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof TranscriptionAuthError) return false;
    if (err instanceof TranscriptionInvalidInputError) return false;
    if (
      err instanceof TranscriptionRateLimitError ||
      err instanceof TranscriptionUnavailableError
    ) {
      return true;
    }
    return true;
  }
}

function classifyError(err: Error | null): string {
  if (!err) return 'UNKNOWN';
  if (err instanceof TranscriptionRateLimitError) return 'RATE_LIMITED';
  if (err instanceof TranscriptionUnavailableError) return 'WHISPER_UNAVAILABLE';
  if (err instanceof TranscriptionInvalidInputError) return 'INVALID_AUDIO';
  if (err instanceof TranscriptionAuthError) return 'AUTH_FAILED';
  return 'UNKNOWN';
}

// Re-export for callers that want to switch on a typed status.
export { FeedbackSource };
