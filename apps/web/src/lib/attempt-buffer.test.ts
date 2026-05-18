// Provide IndexedDB in jsdom via fake-indexeddb.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAttemptBuffer,
  clearAttemptBuffer,
  flushAttemptBuffer,
  getBufferedEntry,
  installOnlineFlusher,
  submitBufferedAnswer,
} from './attempt-buffer';

const apiMock = vi.hoisted(() => ({ submitAttemptAnswer: vi.fn() }));

vi.mock('./api', () => ({ api: apiMock }));

beforeEach(async () => {
  apiMock.submitAttemptAnswer.mockReset();
  await __resetAttemptBuffer();
  // Wipe the underlying IDB so each test starts clean.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('tutor-attempts');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe('submitBufferedAnswer', () => {
  it('on success: persists synced entry + returns server response', async () => {
    apiMock.submitAttemptAnswer.mockResolvedValue({
      questionId: 'q1',
      correct: true,
      correctAnswer: 'walks',
      scoreSoFar: 1,
      gameOver: false,
    });
    const r = await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a1',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    expect(r.response?.correct).toBe(true);
    const persisted = await getBufferedEntry('a1', 'q1');
    expect(persisted?.synced).toBe(true);
    expect(persisted?.response?.correct).toBe(true);
  });

  it('on network failure: keeps entry as un-synced + returns error', async () => {
    apiMock.submitAttemptAnswer.mockRejectedValue(new Error('network'));
    const r = await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a1',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    expect(r.response).toBeUndefined();
    expect(r.error).toBeInstanceOf(Error);
    const persisted = await getBufferedEntry('a1', 'q1');
    expect(persisted?.synced).toBe(false);
  });

  it('flushAttemptBuffer retries failed entries on reconnect', async () => {
    apiMock.submitAttemptAnswer.mockRejectedValueOnce(new Error('offline'));
    await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a1',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    apiMock.submitAttemptAnswer.mockResolvedValue({
      questionId: 'q1',
      correct: true,
      correctAnswer: 'walks',
      scoreSoFar: 1,
      gameOver: false,
    });
    const flushed = await flushAttemptBuffer();
    expect(flushed).toBe(1);
    const persisted = await getBufferedEntry('a1', 'q1');
    expect(persisted?.synced).toBe(true);
  });

  it('flushAttemptBuffer skips already-synced entries', async () => {
    apiMock.submitAttemptAnswer.mockResolvedValue({
      questionId: 'q1',
      correct: true,
      correctAnswer: 'walks',
      scoreSoFar: 1,
      gameOver: false,
    });
    await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a1',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    apiMock.submitAttemptAnswer.mockClear();
    const flushed = await flushAttemptBuffer();
    expect(flushed).toBe(0);
    expect(apiMock.submitAttemptAnswer).not.toHaveBeenCalled();
  });

  it('clearAttemptBuffer removes only entries for the given attempt', async () => {
    apiMock.submitAttemptAnswer.mockResolvedValue({
      questionId: 'q1',
      correct: true,
      correctAnswer: 'walks',
      scoreSoFar: 1,
      gameOver: false,
    });
    await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a1',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a2',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    await clearAttemptBuffer('a1');
    expect(await getBufferedEntry('a1', 'q1')).toBeUndefined();
    expect(await getBufferedEntry('a2', 'q1')).toBeDefined();
  });
});

describe('installOnlineFlusher', () => {
  it('returns a noop when window is undefined (SSR-safe)', () => {
    const realWindow = globalThis.window;
    (globalThis as unknown as { window?: Window }).window = undefined;
    const unsubscribe = installOnlineFlusher();
    unsubscribe();
    (globalThis as unknown as { window?: Window }).window = realWindow;
  });

  it('flushes on online event', async () => {
    apiMock.submitAttemptAnswer
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        questionId: 'q1',
        correct: true,
        correctAnswer: 'walks',
        scoreSoFar: 1,
        gameOver: false,
      });
    await submitBufferedAnswer({
      shareToken: 'tok',
      attemptId: 'a1',
      body: { questionId: 'q1', rawAnswer: 'walks' },
    });
    const unsubscribe = installOnlineFlusher();
    window.dispatchEvent(new Event('online'));
    // The handler is async; wait a tick.
    await new Promise<void>((r) => setTimeout(r, 30));
    const persisted = await getBufferedEntry('a1', 'q1');
    expect(persisted?.synced).toBe(true);
    unsubscribe();
  });
});
