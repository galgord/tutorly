/**
 * IndexedDB-backed offline buffer for answer submissions.
 *
 * Why: a student playing on a flaky train wifi can't lose progress
 * mid-attempt. Every answer first lands in this buffer; the engine
 * then fires the PATCH. On failure the entry stays queued; an
 * `online` listener flushes the queue on reconnect.
 *
 * Idempotency: the server PATCH is keyed by `(attemptId, questionId)`
 * — re-sending an already-recorded answer returns the prior result
 * without double-counting. That's what makes this buffer safe.
 *
 * Schema: one object store keyed by `${attemptId}:${questionId}`,
 * storing the raw submission body + a `synced` boolean. The hook
 * marks an entry synced after the server returns 200.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { SubmitAnswerRequest, SubmitAnswerResponse } from '@tutor-app/shared';
import { api } from './api';

const DB_NAME = 'tutor-attempts';
const STORE = 'pending';
const DB_VERSION = 1;

export interface BufferEntry {
  /** `${attemptId}:${questionId}` — primary key. */
  key: string;
  attemptId: string;
  questionId: string;
  shareToken: string;
  body: SubmitAnswerRequest;
  synced: boolean;
  /** Cached server response so the engine can re-render after the
   *  network round-trip without re-asking the server. */
  response?: SubmitAnswerResponse;
  createdAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

function entryKey(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`;
}

/** Allow tests to override the underlying IndexedDB instance. */
export async function __resetAttemptBuffer(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore — db may already be closed.
    }
  }
  dbPromise = null;
}

/**
 * Persist an answer locally + try to send it. On send failure the
 * entry stays in the buffer for later flush. Returns the server
 * response when reachable, OR a synthesized "buffered" response so
 * the engine can show instant feedback even offline.
 *
 * Note: the LOCAL response is a best-effort echo — it knows the raw
 * answer but not the correct one. The engine's optimistic-UI hook
 * can fill that in from the question pool it holds. When the network
 * returns, we replace this echo with the authoritative server result.
 */
export async function submitBufferedAnswer(opts: {
  shareToken: string;
  attemptId: string;
  body: SubmitAnswerRequest;
}): Promise<{
  buffered: BufferEntry;
  response?: SubmitAnswerResponse;
  error?: Error;
}> {
  const db = await getDb();
  const key = entryKey(opts.attemptId, opts.body.questionId);
  const entry: BufferEntry = {
    key,
    attemptId: opts.attemptId,
    questionId: opts.body.questionId,
    shareToken: opts.shareToken,
    body: opts.body,
    synced: false,
    createdAt: Date.now(),
  };
  await db.put(STORE, entry);

  try {
    const response = await api.submitAttemptAnswer(opts.shareToken, opts.attemptId, opts.body);
    const synced: BufferEntry = { ...entry, synced: true, response };
    await db.put(STORE, synced);
    return { buffered: synced, response };
  } catch (err) {
    return { buffered: entry, error: err as Error };
  }
}

/**
 * Flush any pending (un-synced) entries to the server. Returns the
 * count flushed. Safe to call on every `online` event.
 */
export async function flushAttemptBuffer(): Promise<number> {
  const db = await getDb();
  const all: BufferEntry[] = await db.getAll(STORE);
  let flushed = 0;
  for (const entry of all) {
    if (entry.synced) continue;
    try {
      const response = await api.submitAttemptAnswer(
        entry.shareToken,
        entry.attemptId,
        entry.body,
      );
      await db.put(STORE, { ...entry, synced: true, response });
      flushed += 1;
    } catch {
      // Keep buffered; next flush will retry.
    }
  }
  return flushed;
}

/** Delete buffered entries for a finished attempt to keep the store small. */
export async function clearAttemptBuffer(attemptId: string): Promise<void> {
  const db = await getDb();
  const all: BufferEntry[] = await db.getAll(STORE);
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all(
    all.filter((e) => e.attemptId === attemptId).map((e) => tx.store.delete(e.key)),
  );
  await tx.done;
}

/** Lookup a cached entry. Used by tests + the engine's hydration path. */
export async function getBufferedEntry(
  attemptId: string,
  questionId: string,
): Promise<BufferEntry | undefined> {
  const db = await getDb();
  return db.get(STORE, entryKey(attemptId, questionId));
}

/** Subscribe to flushes on the `online` window event. Returns unsubscriber. */
export function installOnlineFlusher(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    void flushAttemptBuffer();
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
