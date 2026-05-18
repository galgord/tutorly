import { beforeEach, describe, expect, it } from 'vitest';
import {
  TranscriptionInvalidInputError,
  TranscriptionRateLimitError,
  TranscriptionUnavailableError,
} from './whisper.client';
import { FakeTranscriberClient } from './whisper.fake';

describe('FakeTranscriberClient.transcribe', () => {
  let fake: FakeTranscriberClient;
  beforeEach(() => {
    fake = new FakeTranscriberClient();
  });

  it('returns canned English text by default', async () => {
    const res = await fake.transcribe({
      audioPath: '/tmp/whatever.webm',
      locale: 'en',
      durationSeconds: 30,
    });
    expect(res.text).toContain('Sara');
    expect(res.detectedLanguage).toBe('en');
    expect(res.model).toBe('whisper-fake');
  });

  it('returns Hebrew-script text for he locale', async () => {
    const res = await fake.transcribe({
      audioPath: '/tmp/whatever.webm',
      locale: 'he',
      durationSeconds: 30,
    });
    expect(res.text).toMatch(/[֐-׿]/);
    expect(res.detectedLanguage).toBe('he');
  });

  it('returns Portuguese text for pt locale', async () => {
    const res = await fake.transcribe({
      audioPath: '/tmp/whatever.webm',
      locale: 'pt',
      durationSeconds: 30,
    });
    expect(res.text).toMatch(/ser|estar/);
  });

  it('honors __setNextTranscript override once', async () => {
    fake.__setNextTranscript('custom transcript');
    const first = await fake.transcribe({
      audioPath: '/tmp/x.webm',
      locale: 'en',
      durationSeconds: 5,
    });
    expect(first.text).toBe('custom transcript');
    const second = await fake.transcribe({
      audioPath: '/tmp/x.webm',
      locale: 'en',
      durationSeconds: 5,
    });
    // Falls back to canned.
    expect(second.text).not.toBe('custom transcript');
  });

  it('queued rate-limit failures throw then recover', async () => {
    fake.__queueRateLimitFailures(2);
    await expect(
      fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 }),
    ).rejects.toBeInstanceOf(TranscriptionRateLimitError);
    await expect(
      fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 }),
    ).rejects.toBeInstanceOf(TranscriptionRateLimitError);
    const ok = await fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 });
    expect(ok.text.length).toBeGreaterThan(0);
  });

  it('queued unavailable failures throw the typed error', async () => {
    fake.__queueUnavailableFailures(1);
    await expect(
      fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 }),
    ).rejects.toBeInstanceOf(TranscriptionUnavailableError);
  });

  it('queued invalid-input failure throws TranscriptionInvalidInputError', async () => {
    fake.__queueInvalidInputFailures(1);
    await expect(
      fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 }),
    ).rejects.toBeInstanceOf(TranscriptionInvalidInputError);
  });

  it('__reset clears queued failures', async () => {
    fake.__queueRateLimitFailures(5);
    fake.__reset();
    const ok = await fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 });
    expect(ok.text.length).toBeGreaterThan(0);
  });

  it('__callCount tracks invocations', async () => {
    expect(fake.__callCount()).toBe(0);
    await fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 });
    await fake.transcribe({ audioPath: '/x', locale: 'en', durationSeconds: 1 });
    expect(fake.__callCount()).toBe(2);
  });
});
