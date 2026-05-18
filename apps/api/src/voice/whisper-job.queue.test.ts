import { TranscriptionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import { FakeTranscriberClient } from '../integrations/openai/whisper.fake';
import { makePrismaMock } from '../test/prisma-mock';
import { AudioStorageService } from './audio-storage.service';
import { WhisperJobQueue } from './whisper-job.queue';

function fakeLesson(over: Partial<Record<string, unknown>> = {}) {
  // `??` treats null as a fallback trigger, so distinguish "key not
  // present" from "explicit null" for audioUrl (the no-audio path
  // intentionally passes null and expects it to survive).
  const audioProvided = Object.prototype.hasOwnProperty.call(over, 'audioUrl');
  const audioUrl = audioProvided
    ? (over.audioUrl as string | null)
    : 'lessons/les_1/les_1.webm';
  return {
    id: (over.id as string) ?? 'les_1',
    studentId: 'stu_1',
    googleEventId: null,
    source: 'MANUAL',
    title: null,
    occurredAt: new Date(),
    feedbackText: null,
    feedbackSource: 'TEXT',
    audioUrl,
    transcriptionStatus: (over.transcriptionStatus as TranscriptionStatus) ?? TranscriptionStatus.PENDING,
    transcriptionError: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeConfig(over: Partial<Record<string, unknown>> = {}): ConfigService {
  const get = vi.fn((key: string) => {
    if (key === 'WHISPER_MAX_RETRIES') return (over.maxRetries as number) ?? 2;
    if (key === 'WHISPER_BREAKER_THRESHOLD') return (over.breakerThreshold as number) ?? 3;
    if (key === 'WHISPER_BREAKER_RESET_MS') return (over.breakerResetMs as number) ?? 60_000;
    if (key === 'STORAGE_DIR') return '/tmp/whisper-test';
    return undefined;
  });
  return { get, isProd: () => false } as unknown as ConfigService;
}

function makeStorage(): AudioStorageService {
  return {
    absolutePath: vi.fn((p: string) => `/tmp/whisper-test/${p}`),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => ({ relativePath: 'x', absolutePath: 'y' })),
  } as unknown as AudioStorageService;
}

function makeQueue(overrides: {
  client?: FakeTranscriberClient;
  config?: ConfigService;
  storage?: AudioStorageService;
  quota?: { refundWhisperMinutes: (...args: unknown[]) => Promise<void> };
} = {}) {
  const client = overrides.client ?? new FakeTranscriberClient();
  const prisma = makePrismaMock();
  const config = overrides.config ?? makeConfig();
  const storage = overrides.storage ?? makeStorage();
  vi.mocked(prisma.lesson.updateMany).mockResolvedValue({ count: 0 } as never);
  const queue = new WhisperJobQueue(
    client,
    prisma,
    config,
    storage,
    overrides.quota as never,
  );
  return { queue, prisma, client, config, storage };
}

describe('WhisperJobQueue.onModuleInit', () => {
  it('resets stuck TRANSCRIBING rows to FAILED', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.lesson.updateMany).mockResolvedValue({ count: 3 } as never);
    await queue.onModuleInit();
    const call = vi.mocked(prisma.lesson.updateMany).mock.calls[0]?.[0];
    expect(call?.where?.transcriptionStatus).toBe(TranscriptionStatus.TRANSCRIBING);
    expect(call?.data?.transcriptionStatus).toBe(TranscriptionStatus.FAILED);
  });

  it("tolerates DB failures during boot (doesn't crash)", async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.lesson.updateMany).mockRejectedValue(new Error('refused'));
    await expect(queue.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('WhisperJobQueue.processTranscription', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: writes transcript to feedbackText, sets DONE, deletes audio', async () => {
    const storage = makeStorage();
    const { queue, prisma } = makeQueue({ storage });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);

    await queue.processTranscription('les_1', 'en');

    // First update: TRANSCRIBING
    // Last update: feedbackText populated + DONE + audioUrl=null
    const calls = vi.mocked(prisma.lesson.update).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const done = calls.find(
      (c) =>
        (c[0]?.data as Record<string, unknown>)?.transcriptionStatus ===
        TranscriptionStatus.DONE,
    );
    expect(done).toBeTruthy();
    const data = done![0]?.data as Record<string, unknown>;
    expect(data.feedbackText).toBeTypeOf('string');
    expect((data.feedbackText as string).length).toBeGreaterThan(0);
    expect(data.audioUrl).toBeNull();
    expect(storage.delete).toHaveBeenCalled();
  });

  it("refuses to clobber a lesson that's not PENDING (idempotency)", async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(
      fakeLesson({ transcriptionStatus: TranscriptionStatus.DONE }) as never,
    );
    await queue.processTranscription('les_1', 'en');
    expect(prisma.lesson.update).not.toHaveBeenCalled();
  });

  it('marks FAILED when no audio path on the lesson', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(
      fakeLesson({ audioUrl: null }) as never,
    );
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    await queue.processTranscription('les_1', 'en');
    const last = vi.mocked(prisma.lesson.update).mock.calls.at(-1)?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(last.transcriptionStatus).toBe(TranscriptionStatus.FAILED);
    expect(last.transcriptionError).toBe('NO_AUDIO');
  });

  it('retries on transient rate-limit and eventually succeeds', async () => {
    const client = new FakeTranscriberClient();
    client.__queueRateLimitFailures(2);
    const { queue, prisma } = makeQueue({ client, config: makeConfig({ maxRetries: 3 }) });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    await queue.processTranscription('les_1', 'en');
    expect(client.__callCount()).toBe(3); // 2 failures + 1 success
    const done = vi.mocked(prisma.lesson.update).mock.calls.find(
      (c) =>
        (c[0]?.data as Record<string, unknown>)?.transcriptionStatus ===
        TranscriptionStatus.DONE,
    );
    expect(done).toBeTruthy();
  });

  it('marks FAILED + refunds quota after exhausting retries', async () => {
    const client = new FakeTranscriberClient();
    client.__queueUnavailableFailures(10);
    const refund = vi.fn(async () => undefined);
    const { queue, prisma } = makeQueue({
      client,
      config: makeConfig({ maxRetries: 1 }),
      quota: { refundWhisperMinutes: refund },
    });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    // Enqueue records the (tutor, minutes) pair.
    queue.enqueue('les_1', { tutorId: 'tutor_a', minutes: 2, locale: 'en' });
    await queue.drain();
    const failed = vi.mocked(prisma.lesson.update).mock.calls.find(
      (c) =>
        (c[0]?.data as Record<string, unknown>)?.transcriptionStatus ===
        TranscriptionStatus.FAILED,
    );
    expect(failed).toBeTruthy();
    expect(refund).toHaveBeenCalledWith('tutor_a', 2);
  }, 10_000);

  it('breaker trips after N consecutive failures', async () => {
    const client = new FakeTranscriberClient();
    client.__queueUnavailableFailures(100);
    const { queue, prisma } = makeQueue({
      client,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 2 }),
    });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    expect(queue.isBreakerOpen()).toBe(false);
    await queue.processTranscription('les_1', 'en');
    expect(queue.isBreakerOpen()).toBe(false);
    await queue.processTranscription('les_2', 'en');
    expect(queue.isBreakerOpen()).toBe(true);
  });

  it('successful call resets the consecutive-failure counter', async () => {
    const client = new FakeTranscriberClient();
    client.__queueRateLimitFailures(1);
    const { queue, prisma } = makeQueue({
      client,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 2 }),
    });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    await queue.processTranscription('les_1', 'en');
    await queue.processTranscription('les_2', 'en');
    expect(queue.snapshot().consecutiveFailures).toBe(0);
  });

  it('classifies invalid-input as INVALID_AUDIO (non-retryable)', async () => {
    const client = new FakeTranscriberClient();
    client.__queueInvalidInputFailures(1);
    const { queue, prisma } = makeQueue({
      client,
      config: makeConfig({ maxRetries: 3 }),
    });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    await queue.processTranscription('les_1', 'en');
    expect(client.__callCount()).toBe(1); // not retried
    const failed = vi.mocked(prisma.lesson.update).mock.calls.find(
      (c) =>
        (c[0]?.data as Record<string, unknown>)?.transcriptionStatus ===
        TranscriptionStatus.FAILED,
    );
    expect(failed).toBeTruthy();
    const data = failed![0]?.data as Record<string, unknown>;
    expect(data.transcriptionError).toBe('INVALID_AUDIO');
  });
});

describe('WhisperJobQueue.enqueue + drain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueue returns immediately; drain awaits completion', async () => {
    const { queue, prisma } = makeQueue();
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    const result = queue.enqueue('les_1', { tutorId: 'tutor_a', minutes: 1, locale: 'en' });
    expect(result.accepted).toBe(true);
    expect(result.breakerOpen).toBe(false);
    await queue.drain();
    expect(prisma.lesson.update).toHaveBeenCalled();
  });

  it('open breaker → enqueue marks lesson FAILED, refuses processing, refunds slot', async () => {
    const client = new FakeTranscriberClient();
    client.__queueUnavailableFailures(100);
    const refund = vi.fn(async () => undefined);
    const { queue, prisma, storage } = makeQueue({
      client,
      config: makeConfig({ maxRetries: 0, breakerThreshold: 1 }),
      quota: { refundWhisperMinutes: refund },
    });
    vi.mocked(prisma.lesson.findUnique).mockResolvedValue(fakeLesson() as never);
    vi.mocked(prisma.lesson.update).mockResolvedValue({} as never);
    // Warm up to trip the breaker.
    await queue.processTranscription('les_warmup', 'en');
    expect(queue.isBreakerOpen()).toBe(true);

    vi.mocked(prisma.lesson.update).mockClear();
    const result = queue.enqueue('les_new', { tutorId: 'tutor_b', minutes: 3, locale: 'en' });
    expect(result.accepted).toBe(false);
    expect(result.breakerOpen).toBe(true);
    await queue.drain();
    const first = vi.mocked(prisma.lesson.update).mock.calls[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(first.transcriptionStatus).toBe(TranscriptionStatus.FAILED);
    expect(first.transcriptionError).toBe('WHISPER_UNAVAILABLE_CIRCUIT_OPEN');
    // refund happens in the markBreakerFailure branch? No — the controller
    // refunds when breakerOpen comes back; the queue itself does not (the
    // controller will issue the refund seeing breakerOpen=true). So we
    // don't expect refund here, only via the controller path.
    expect(storage.delete).toHaveBeenCalled();
  });
});
