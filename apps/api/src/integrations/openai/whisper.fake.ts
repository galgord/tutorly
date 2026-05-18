import { Injectable, Logger } from '@nestjs/common';
import {
  type TranscriberClient,
  type TranscriptionRequest,
  type TranscriptionResult,
  TranscriptionInvalidInputError,
  TranscriptionRateLimitError,
  TranscriptionUnavailableError,
} from './whisper.client';

/**
 * Programmable in-memory fake of TranscriberClient.
 *
 * Defaults: returns a deterministic locale-aware transcript so the full
 * voice → review → save flow can be exercised in dev + E2E without burning
 * OpenAI credit. Programmable failure modes exist for retry + circuit-breaker
 * tests.
 *
 * State is module-scoped (single instance per process); tests should call
 * __reset() in beforeEach when they programmed failures.
 */
@Injectable()
export class FakeTranscriberClient implements TranscriberClient {
  private readonly logger = new Logger(FakeTranscriberClient.name);

  private failuresQueued = 0;
  private failureKind: 'rate_limit' | 'unavailable' | 'invalid_input' | null = null;
  private callCount = 0;
  private overrideText: string | null = null;

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    this.callCount += 1;

    // Pop a programmed failure if one is queued.
    if (this.failuresQueued > 0 && this.failureKind !== null) {
      this.failuresQueued -= 1;
      const kind = this.failureKind;
      if (this.failuresQueued === 0) this.failureKind = null;
      if (kind === 'rate_limit') throw new TranscriptionRateLimitError();
      if (kind === 'unavailable') throw new TranscriptionUnavailableError();
      throw new TranscriptionInvalidInputError();
    }

    if (this.overrideText !== null) {
      const text = this.overrideText;
      this.overrideText = null;
      return { text, detectedLanguage: req.locale, model: 'whisper-fake' };
    }

    return {
      text: this.cannedTextFor(req.locale),
      detectedLanguage: req.locale,
      model: 'whisper-fake',
    };
  }

  private cannedTextFor(locale: string): string {
    if (locale === 'he') {
      return 'דניאל התקשה עם הטיית פעלים בזמן הווה. כדאי לתרגל גוף ראשון ולחזק את אוצר המילים סביב פעולות יומיומיות.';
    }
    if (locale === 'pt') {
      return 'Sara confundiu ser e estar durante o exame. Vamos praticar a diferença entre estado físico e emocional na próxima sessão.';
    }
    return 'Sara confused ser and estar during the exam today. We should drill the difference between physical state and emotional state in our next session.';
  }

  // ---- Test-only setters -----------------------------------------------

  __reset(): void {
    this.failuresQueued = 0;
    this.failureKind = null;
    this.callCount = 0;
    this.overrideText = null;
  }

  __queueRateLimitFailures(count: number): void {
    this.failuresQueued = count;
    this.failureKind = 'rate_limit';
  }

  __queueUnavailableFailures(count: number): void {
    this.failuresQueued = count;
    this.failureKind = 'unavailable';
  }

  __queueInvalidInputFailures(count: number): void {
    this.failuresQueued = count;
    this.failureKind = 'invalid_input';
  }

  /** Returns this exact transcript on the next call only. */
  __setNextTranscript(text: string): void {
    this.overrideText = text;
  }

  __callCount(): number {
    return this.callCount;
  }
}
