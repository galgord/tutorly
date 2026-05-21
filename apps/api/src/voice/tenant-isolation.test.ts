import { NotFoundException } from '@nestjs/common';
import { LessonSource, TranscriptionStatus } from '@prisma/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { ConfigService } from '../config/config.service';
import type { CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { FakeTranscriberClient } from '../integrations/openai/whisper.fake';
import { LessonService } from '../lessons/lesson.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { AudioStorageService } from './audio-storage.service';
import { VoiceController } from './voice.controller';
import { WhisperJobQueue } from './whisper-job.queue';

/**
 * Live-Postgres smoke for the Phase 5 voice endpoints' tenant isolation
 * contract. Tutor B must NEVER be able to upload audio to or read the
 * transcription status of tutor A's lesson — failure mode is always 404,
 * never 401/403, so existence is not leaked.
 *
 * Skips automatically when DATABASE_URL is unreachable.
 */

// Minimal WAV magic bytes.
const WAV_FIXTURE = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0, 0, 0x01, 0, 0x01, 0,
  0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 0x02, 0, 0x10, 0,
]);

function makeTestConfig(dir: string): ConfigService {
  const get = vi.fn((key: string) => {
    if (key === 'STORAGE_DIR') return dir;
    if (key === 'WHISPER_MAX_RETRIES') return 1;
    if (key === 'WHISPER_BREAKER_THRESHOLD') return 5;
    if (key === 'WHISPER_BREAKER_RESET_MS') return 60_000;
    if (key === 'WHISPER_MONTHLY_MINUTES_CAP') return 60;
    return undefined;
  });
  return { get, isProd: () => false } as unknown as ConfigService;
}

describe('Voice tenant isolation (live db)', () => {
  const prisma = new PrismaService();
  let lessons: LessonService;
  let controller: VoiceController;
  let queue: WhisperJobQueue;
  let storageDir: string;
  let tutorA = '';
  let tutorB = '';
  let lessonA = '';
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    storageDir = mkdtempSync(join(tmpdir(), 'voice-iso-'));
    const config = makeTestConfig(storageDir);
    const audit = new AuditService(prisma);
    const quota = new QuotaService(prisma, config, audit);
    const storage = new AudioStorageService(config);
    const transcriber = new FakeTranscriberClient();
    queue = new WhisperJobQueue(transcriber, prisma, config, storage, quota);
    lessons = new LessonService(prisma);
    controller = new VoiceController(lessons, prisma, audit, storage, quota, queue);
  });

  beforeEach(async () => {
    if (!dbReady) return;
    const a = await prisma.tutor.create({
      data: { email: `voice-iso-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const b = await prisma.tutor.create({
      data: { email: `voice-iso-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const sa = await prisma.student.create({
      data: { tutorId: a.id, name: 'Sara-A', shareToken: `vt-${Math.random().toString(36).slice(2, 12)}` },
    });
    await prisma.student.create({
      data: { tutorId: b.id, name: 'Sara-B', shareToken: `vt-${Math.random().toString(36).slice(2, 12)}` },
    });
    const la = await lessons.createLesson({
      studentId: sa.id,
      tutorId: a.id,
      occurredAt: new Date(Date.now() - 86_400_000),
      source: LessonSource.MANUAL,
    });
    tutorA = a.id;
    tutorB = b.id;
    lessonA = la.id;
  });

  afterAll(async () => {
    if (!dbReady) return;
    try {
      await prisma.tutor.deleteMany({
        where: { email: { startsWith: 'voice-iso-' } },
      });
    } finally {
      await prisma.$disconnect();
      rmSync(storageDir, { recursive: true, force: true });
    }
  });

  const fakeReq = () =>
    ({ ip: '127.0.0.1', header: () => undefined, body: { durationSeconds: '15' } }) as never;

  it("tutor B cannot upload audio to tutor A's lesson (404, not 401)", async () => {
    if (!dbReady) return;
    const tutor: CurrentTutorPayload = {
      id: tutorB,
      email: 'b@example.com',
      name: 'B',
      locale: 'en',
    };
    const file = {
      buffer: WAV_FIXTURE,
      size: WAV_FIXTURE.length,
      originalname: 'a.wav',
      mimetype: 'audio/wav',
    };
    await expect(
      controller.upload(tutor, lessonA, file, fakeReq()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("tutor B cannot read transcription status of tutor A's lesson (404)", async () => {
    if (!dbReady) return;
    const tutor: CurrentTutorPayload = {
      id: tutorB,
      email: 'b@example.com',
      name: 'B',
      locale: 'en',
    };
    await expect(controller.status(tutor, lessonA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tutor A happy path: upload → job runs → transcript populated, audio file removed, slot consumed', async () => {
    if (!dbReady) return;
    const tutor: CurrentTutorPayload = {
      id: tutorA,
      email: 'a@example.com',
      name: 'A',
      locale: 'en',
    };
    const file = {
      buffer: WAV_FIXTURE,
      size: WAV_FIXTURE.length,
      originalname: 'a.wav',
      mimetype: 'audio/wav',
    };
    const res = await controller.upload(tutor, lessonA, file, fakeReq());
    expect(res.lessonId).toBe(lessonA);
    // PENDING immediately (queue runs on next tick).
    expect([
      TranscriptionStatus.PENDING,
      TranscriptionStatus.TRANSCRIBING,
      TranscriptionStatus.DONE,
    ]).toContain(res.transcriptionStatus);
    await queue.drain();
    const after = await prisma.lesson.findUnique({ where: { id: lessonA } });
    expect(after?.transcriptionStatus).toBe(TranscriptionStatus.DONE);
    expect(after?.feedbackText).toBeTruthy();
    expect(after?.audioUrl).toBeNull();
    // Slot consumed (1 minute since 15s rounds up to 1).
    const tutorAfter = await prisma.tutor.findUnique({
      where: { id: tutorA },
      select: { monthlyWhisperMinutes: true },
    });
    expect(tutorAfter?.monthlyWhisperMinutes).toBe(1);
  });
});
