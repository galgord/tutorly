import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TranscriptionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { CurrentTutorPayload } from '../auth/current-tutor.decorator';
import type { LessonService } from '../lessons/lesson.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { QuotaService } from '../quota/quota.service';
import type { AudioStorageService } from './audio-storage.service';
import { VoiceController } from './voice.controller';
import type { WhisperJobQueue } from './whisper-job.queue';

const tutorA: CurrentTutorPayload = { id: 'tutor_a', email: 'a@example.com', name: 'A', locale: 'en' };

// Minimal WAV magic so sniffAudioMime passes.
const WAV_BUFFER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0, 0, 0x01, 0, 0x01, 0,
  0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 0x02, 0, 0x10, 0,
]);

function fakeFile(buf: Buffer = WAV_BUFFER) {
  return {
    buffer: buf,
    size: buf.length,
    originalname: 'audio.webm',
    mimetype: 'audio/webm',
  };
}

function fakeReq(body: Record<string, unknown> = { durationSeconds: '30' }) {
  return {
    ip: '127.0.0.1',
    header: () => undefined,
    body,
  } as never;
}

function makeController(opts: {
  lessons?: Partial<LessonService>;
  storage?: Partial<AudioStorageService>;
  queue?: Partial<WhisperJobQueue>;
  quota?: Partial<QuotaService>;
  prisma?: {
    lesson?: {
      update?: ReturnType<typeof vi.fn>;
      findUnique?: ReturnType<typeof vi.fn>;
    };
    tutor?: {
      findUnique?: ReturnType<typeof vi.fn>;
    };
  };
  transcriptionStatus?: TranscriptionStatus;
} = {}) {
  const lessons = {
    getLessonForTutorOrFail: vi.fn().mockResolvedValue({
      id: 'les_1',
      studentId: 'stu_1',
      transcriptionStatus: opts.transcriptionStatus ?? TranscriptionStatus.NONE,
      transcriptionError: null,
      audioUrl: null,
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    }),
    ...opts.lessons,
  } as unknown as LessonService;

  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const storage = {
    save: vi.fn().mockResolvedValue({ relativePath: 'lessons/les_1/les_1.wav', absolutePath: '/x' }),
    delete: vi.fn().mockResolvedValue(undefined),
    absolutePath: vi.fn((p: string) => `/abs/${p}`),
    ...opts.storage,
  } as unknown as AudioStorageService;
  const queue = {
    enqueue: vi.fn().mockReturnValue({ accepted: true, breakerOpen: false }),
    ...opts.queue,
  } as unknown as WhisperJobQueue;
  const quota = {
    reserveWhisperMinutes: vi.fn().mockResolvedValue({
      ok: true,
      used: 1,
      cap: 60,
      resetsAt: new Date('2026-06-01T00:00:00Z'),
    }),
    refundWhisperMinutes: vi.fn().mockResolvedValue(undefined),
    ...opts.quota,
  } as unknown as QuotaService;

  const lessonUpdate = opts.prisma?.lesson?.update ?? vi.fn().mockResolvedValue({
    id: 'les_1',
    transcriptionStatus: TranscriptionStatus.PENDING,
    transcriptionError: null,
    audioUrl: 'lessons/les_1/les_1.wav',
  });
  const lessonFindUnique = opts.prisma?.lesson?.findUnique ?? vi.fn().mockResolvedValue({
    id: 'les_1',
    transcriptionStatus: TranscriptionStatus.PENDING,
    transcriptionError: null,
    audioUrl: 'lessons/les_1/les_1.wav',
  });
  const tutorFindUnique = opts.prisma?.tutor?.findUnique ?? vi.fn().mockResolvedValue({ locale: 'en' });
  const prisma = {
    lesson: { update: lessonUpdate, findUnique: lessonFindUnique },
    tutor: { findUnique: tutorFindUnique },
  } as unknown as PrismaService;

  return {
    controller: new VoiceController(lessons, prisma, audit, storage, quota, queue),
    lessons,
    storage,
    queue,
    quota,
    audit,
    prisma: { lessonUpdate, lessonFindUnique, tutorFindUnique },
  };
}

describe('VoiceController.upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing file', async () => {
    const { controller } = makeController();
    await expect(controller.upload(tutorA, 'les_1', undefined, fakeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when a transcription is already in progress', async () => {
    const { controller } = makeController({ transcriptionStatus: TranscriptionStatus.TRANSCRIBING });
    await expect(
      controller.upload(tutorA, 'les_1', fakeFile(), fakeReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing durationSeconds form field', async () => {
    const { controller } = makeController();
    await expect(
      controller.upload(tutorA, 'les_1', fakeFile(), fakeReq({})),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects audio over the 5min duration cap', async () => {
    const { controller } = makeController();
    await expect(
      controller.upload(tutorA, 'les_1', fakeFile(), fakeReq({ durationSeconds: '500' })),
    ).rejects.toThrow(/too long/);
  });

  it('rejects non-audio bytes', async () => {
    const { controller } = makeController();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
    await expect(
      controller.upload(tutorA, 'les_1', fakeFile(png), fakeReq()),
    ).rejects.toThrow(/unsupported audio/);
  });

  it('refuses + does NOT save when quota is exceeded', async () => {
    const { controller, storage } = makeController({
      quota: {
        reserveWhisperMinutes: vi.fn().mockResolvedValue({
          ok: false,
          used: 60,
          cap: 60,
          resetsAt: new Date('2026-06-01T00:00:00Z'),
        }),
      },
    });
    await expect(
      controller.upload(tutorA, 'les_1', fakeFile(), fakeReq()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('happy path: saves audio, marks PENDING, enqueues job, audits with bytes/duration', async () => {
    const { controller, storage, queue, quota, audit, prisma } = makeController();
    const res = await controller.upload(tutorA, 'les_1', fakeFile(), fakeReq());
    expect(storage.save).toHaveBeenCalled();
    expect(prisma.lessonUpdate).toHaveBeenCalled();
    const update = vi.mocked(prisma.lessonUpdate).mock.calls[0]?.[0];
    expect(update?.data?.transcriptionStatus).toBe(TranscriptionStatus.PENDING);
    expect(queue.enqueue).toHaveBeenCalledWith('les_1', {
      tutorId: 'tutor_a',
      minutes: 1,
      locale: 'en',
    });
    expect(quota.reserveWhisperMinutes).toHaveBeenCalledWith('tutor_a', 1);
    expect(audit.record).toHaveBeenCalled();
    const auditMeta = vi.mocked(audit.record).mock.calls[0]?.[0]?.metadata as Record<
      string,
      unknown
    >;
    expect(auditMeta.bytes).toBe(WAV_BUFFER.length);
    expect(auditMeta.durationSeconds).toBe(30);
    expect(auditMeta.minutesReserved).toBe(1);
    expect(auditMeta.localeHint).toBe('en');
    expect(res.transcriptionStatus).toBe(TranscriptionStatus.PENDING);
    expect(res.lessonId).toBe('les_1');
  });

  it('rounds duration up to whole minutes for quota purposes', async () => {
    const { controller, quota } = makeController();
    await controller.upload(tutorA, 'les_1', fakeFile(), fakeReq({ durationSeconds: '61' }));
    expect(quota.reserveWhisperMinutes).toHaveBeenCalledWith('tutor_a', 2);
  });

  it('refunds the slot when the breaker is open', async () => {
    const { controller, quota } = makeController({
      queue: {
        enqueue: vi.fn().mockReturnValue({ accepted: false, breakerOpen: true }),
      },
    });
    await controller.upload(tutorA, 'les_1', fakeFile(), fakeReq());
    expect(quota.refundWhisperMinutes).toHaveBeenCalledWith('tutor_a', 1);
  });

  it('refunds the slot if storage.save throws', async () => {
    const { controller, quota } = makeController({
      storage: { save: vi.fn().mockRejectedValue(new Error('disk full')) },
    });
    await expect(
      controller.upload(tutorA, 'les_1', fakeFile(), fakeReq()),
    ).rejects.toThrow('disk full');
    expect(quota.refundWhisperMinutes).toHaveBeenCalledWith('tutor_a', 1);
  });
});

describe('VoiceController.status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the lesson transcription status', async () => {
    const { controller } = makeController({ transcriptionStatus: TranscriptionStatus.DONE });
    const r = await controller.status(tutorA, 'les_1');
    expect(r.transcriptionStatus).toBe('DONE');
    expect(r.lessonId).toBe('les_1');
  });

  it('uses LessonService.getLessonForTutorOrFail (tenant-scoped)', async () => {
    const { controller, lessons } = makeController();
    await controller.status(tutorA, 'les_1');
    expect(lessons.getLessonForTutorOrFail).toHaveBeenCalledWith({
      id: 'les_1',
      tutorId: 'tutor_a',
    });
  });
});
