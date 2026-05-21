import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LessonSource } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { CurrentTutorPayload } from '../auth/current-tutor.decorator';
import type { GoogleIntegrationService } from '../integrations/google/google-integration.service';
import { LessonsController, serializeLesson } from './lessons.controller';
import type { LessonService, LessonWithStudent } from './lesson.service';

const tutorA: CurrentTutorPayload = { id: 'tutor_a', email: 'a@example.com', name: 'A', locale: 'en' };

function fakeLesson(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over.id ?? 'les_1',
    studentId: over.studentId ?? 'stu_1',
    googleEventId: (over.googleEventId as string | null | undefined) ?? null,
    source: (over.source as LessonSource | undefined) ?? LessonSource.MANUAL,
    title: (over.title as string | null | undefined) ?? null,
    occurredAt: (over.occurredAt as Date | undefined) ?? new Date('2026-05-01T10:00:00Z'),
    agenda: (over.agenda as string | null | undefined) ?? null,
    feedbackText: (over.feedbackText as string | null | undefined) ?? null,
    feedbackSource: 'TEXT',
    audioUrl: null,
    transcriptionStatus: 'NONE',
    transcriptionError: null,
    deletedAt: (over.deletedAt as Date | null | undefined) ?? null,
    createdAt: (over.createdAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: (over.updatedAt as Date | undefined) ?? new Date('2026-05-01T00:00:00Z'),
  };
}

function fakeReq() {
  return { ip: '127.0.0.1', header: () => undefined } as unknown as Parameters<
    LessonsController['create']
  >[2];
}

function makeController(overrides: {
  lessons?: Partial<LessonService>;
  google?: Partial<GoogleIntegrationService>;
} = {}) {
  const lessons = {
    createLesson: vi.fn().mockResolvedValue(fakeLesson()),
    listForStudent: vi.fn().mockResolvedValue({ items: [fakeLesson()], total: 1 }),
    getLessonForTutorOrFail: vi.fn().mockResolvedValue({
      ...fakeLesson(),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    }),
    softDelete: vi.fn().mockResolvedValue(fakeLesson({ deletedAt: new Date() })),
    restore: vi.fn().mockResolvedValue(fakeLesson()),
    listLocalLessonsInRange: vi.fn().mockResolvedValue([]),
    updateFeedback: vi.fn().mockResolvedValue(fakeLesson({ feedbackText: 'saved' })),
    updateAgenda: vi.fn().mockResolvedValue(fakeLesson({ agenda: 'saved plan' })),
    ...overrides.lessons,
  } as unknown as LessonService;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const google = {
    listEventsForTutor: vi.fn().mockResolvedValue({ ok: true, events: [] }),
    ...overrides.google,
  } as unknown as GoogleIntegrationService;
  return { controller: new LessonsController(lessons, audit, google), lessons, audit, google };
}

describe('LessonsController.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid bodies', async () => {
    const { controller } = makeController();
    await expect(
      controller.create(tutorA, { studentId: '', occurredAt: '' }, fakeReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes tutorId from CurrentTutor; sets source=MANUAL without googleEventId', async () => {
    const { controller, lessons } = makeController();
    await controller.create(
      tutorA,
      { studentId: 'stu_1', occurredAt: '2026-05-01T10:00:00Z', title: 'first' },
      fakeReq(),
    );
    expect(lessons.createLesson).toHaveBeenCalledWith({
      studentId: 'stu_1',
      tutorId: 'tutor_a',
      occurredAt: new Date('2026-05-01T10:00:00Z'),
      title: 'first',
      googleEventId: null,
      source: LessonSource.MANUAL,
    });
  });

  it('sets source=GOOGLE_CALENDAR when googleEventId is provided', async () => {
    const { controller, lessons } = makeController();
    await controller.create(
      tutorA,
      {
        studentId: 'stu_1',
        occurredAt: '2026-05-01T10:00:00Z',
        googleEventId: 'gevt-1',
      },
      fakeReq(),
    );
    expect(vi.mocked(lessons.createLesson).mock.calls[0]?.[0]?.source).toBe(
      LessonSource.GOOGLE_CALENDAR,
    );
  });

  it('audits lesson.created', async () => {
    const { controller, audit } = makeController();
    await controller.create(
      tutorA,
      { studentId: 'stu_1', occurredAt: '2026-05-01T10:00:00Z' },
      fakeReq(),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lesson.created', entityId: 'les_1' }),
    );
  });
});

describe('LessonsController.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects without studentId', async () => {
    const { controller } = makeController();
    await expect(controller.list(tutorA, { page: '1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('passes studentId + pagination to the service', async () => {
    const { controller, lessons } = makeController();
    await controller.list(tutorA, { studentId: 'stu_1', page: '2', limit: '5' });
    expect(lessons.listForStudent).toHaveBeenCalledWith({
      studentId: 'stu_1',
      tutorId: 'tutor_a',
      page: 2,
      limit: 5,
    });
  });
});

describe('LessonsController.get / delete / restore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get returns 404 when service throws', async () => {
    const { controller } = makeController({
      lessons: { getLessonForTutorOrFail: vi.fn().mockRejectedValue(new NotFoundException()) },
    });
    await expect(controller.get(tutorA, 'les_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get includes the student name in response', async () => {
    const { controller } = makeController();
    const out = await controller.get(tutorA, 'les_1');
    expect(out.studentName).toBe('Sara');
  });

  it('delete audits lesson.deleted', async () => {
    const { controller, audit } = makeController();
    await controller.remove(tutorA, 'les_1', fakeReq());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lesson.deleted', entityId: 'les_1' }),
    );
  });

  it('restore audits lesson.restored', async () => {
    const { controller, audit } = makeController();
    await controller.restore(tutorA, 'les_1', fakeReq());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lesson.restored', entityId: 'les_1' }),
    );
  });
});

describe('LessonsController.calendar (merge logic)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects from > to', async () => {
    const { controller } = makeController();
    await expect(
      controller.calendar(tutorA, {
        from: '2026-05-10T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
      }),
    ).rejects.toThrow(/`from` must be before/);
  });

  it('rejects invalid query shape', async () => {
    const { controller } = makeController();
    await expect(controller.calendar(tutorA, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns purely manual lessons when Google is disconnected', async () => {
    const local: LessonWithStudent = {
      ...fakeLesson({ id: 'les_manual_1', title: 'Manual lesson' }),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never;
    const { controller, google } = makeController({
      lessons: { listLocalLessonsInRange: vi.fn().mockResolvedValue([local]) },
    });
    vi.mocked(google.listEventsForTutor).mockResolvedValue({ ok: false, error: 'disconnected' });

    const res = await controller.calendar(tutorA, {
      from: '2026-04-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.source).toBe(LessonSource.MANUAL);
    expect(res.items[0]?.hasLocalLesson).toBe(true);
    expect(res.items[0]?.studentName).toBe('Sara');
  });

  it('dedupes events by googleEventId (local lesson preferred)', async () => {
    const local: LessonWithStudent = {
      ...fakeLesson({
        id: 'les_1',
        googleEventId: 'gevt-1',
        source: LessonSource.GOOGLE_CALENDAR,
        title: 'My override title',
        occurredAt: new Date('2026-05-01T10:00:00Z'),
      }),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never;
    const { controller, google } = makeController({
      lessons: { listLocalLessonsInRange: vi.fn().mockResolvedValue([local]) },
    });
    vi.mocked(google.listEventsForTutor).mockResolvedValue({
      ok: true,
      events: [
        {
          id: 'gevt-1',
          calendarId: 'cal-primary',
          title: 'Google title',
          startsAt: '2026-05-01T10:00:00.000Z',
          endsAt: '2026-05-01T11:00:00.000Z',
        },
      ],
    });
    const res = await controller.calendar(tutorA, {
      from: '2026-04-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
    });
    expect(res.items).toHaveLength(1);
    const item = res.items[0]!;
    expect(item.googleEventId).toBe('gevt-1');
    expect(item.hasLocalLesson).toBe(true);
    expect(item.localLessonId).toBe('les_1');
    // Local title beats Google title when both exist.
    expect(item.title).toBe('My override title');
  });

  it('surfaces orphaned local lessons (event deleted on Google) as MANUAL', async () => {
    const local: LessonWithStudent = {
      ...fakeLesson({
        id: 'les_1',
        googleEventId: 'gevt-gone',
        source: LessonSource.GOOGLE_CALENDAR,
        title: 'Orphan',
      }),
      student: { id: 'stu_1', name: 'Sara', tutorId: 'tutor_a' },
    } as never;
    const { controller, google } = makeController({
      lessons: { listLocalLessonsInRange: vi.fn().mockResolvedValue([local]) },
    });
    // Google returns NO event matching `gevt-gone`.
    vi.mocked(google.listEventsForTutor).mockResolvedValue({ ok: true, events: [] });
    const res = await controller.calendar(tutorA, {
      from: '2026-04-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.source).toBe(LessonSource.MANUAL);
    expect(res.items[0]?.googleEventId).toBe('gevt-gone');
    expect(res.items[0]?.hasLocalLesson).toBe(true);
  });

  it('orders past desc then future asc', async () => {
    const now = Date.now();
    const past1 = new Date(now - 5 * 86_400_000).toISOString();
    const past2 = new Date(now - 1 * 86_400_000).toISOString();
    const future1 = new Date(now + 1 * 86_400_000).toISOString();
    const future2 = new Date(now + 5 * 86_400_000).toISOString();
    const { controller, google } = makeController({});
    vi.mocked(google.listEventsForTutor).mockResolvedValue({
      ok: true,
      events: [
        { id: 'e-past1', calendarId: 'c', title: 'past1', startsAt: past1, endsAt: null },
        { id: 'e-future2', calendarId: 'c', title: 'future2', startsAt: future2, endsAt: null },
        { id: 'e-past2', calendarId: 'c', title: 'past2', startsAt: past2, endsAt: null },
        { id: 'e-future1', calendarId: 'c', title: 'future1', startsAt: future1, endsAt: null },
      ],
    });
    const res = await controller.calendar(tutorA, {
      from: new Date(now - 10 * 86_400_000).toISOString(),
      to: new Date(now + 10 * 86_400_000).toISOString(),
    });
    const titles = res.items.map((i) => i.title);
    // Past desc (most recent first) then future asc.
    expect(titles).toEqual(['past2', 'past1', 'future1', 'future2']);
  });
});

describe('LessonsController.setFeedback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 on missing feedbackText', async () => {
    const { controller } = makeController();
    await expect(
      controller.setFeedback(tutorA, 'les_1', {}, fakeReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 on whitespace-only feedback', async () => {
    const { controller } = makeController();
    await expect(
      controller.setFeedback(tutorA, 'les_1', { feedbackText: '   ' }, fakeReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards to service and audits with length (not raw text)', async () => {
    const { controller, lessons, audit } = makeController();
    await controller.setFeedback(
      tutorA,
      'les_1',
      { feedbackText: 'Sara confused ser/estar.' },
      fakeReq(),
    );
    expect(lessons.updateFeedback).toHaveBeenCalledWith({
      id: 'les_1',
      tutorId: 'tutor_a',
      feedbackText: 'Sara confused ser/estar.',
      source: 'TEXT',
    });
    const auditCall = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('lesson.feedback.updated');
    expect((auditCall?.metadata as Record<string, unknown>).length).toBe(24);
    // PII: raw feedback text must NEVER appear in audit metadata.
    expect(JSON.stringify(auditCall?.metadata)).not.toContain('Sara');
  });
});

describe('LessonsController.setAgenda', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 on agenda over the length cap', async () => {
    const { controller } = makeController();
    await expect(
      controller.setAgenda(tutorA, 'les_1', { agenda: 'x'.repeat(4_001) }, fakeReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an empty string (clears the agenda) and forwards to the service', async () => {
    const { controller, lessons } = makeController();
    await controller.setAgenda(tutorA, 'les_1', { agenda: '' }, fakeReq());
    expect(lessons.updateAgenda).toHaveBeenCalledWith({
      id: 'les_1',
      tutorId: 'tutor_a',
      agenda: '',
    });
  });

  it('forwards to the service and audits with length (not raw text)', async () => {
    const { controller, lessons, audit } = makeController();
    await controller.setAgenda(
      tutorA,
      'les_1',
      { agenda: 'Review past tense with Sara.' },
      fakeReq(),
    );
    expect(lessons.updateAgenda).toHaveBeenCalledWith({
      id: 'les_1',
      tutorId: 'tutor_a',
      agenda: 'Review past tense with Sara.',
    });
    const auditCall = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('lesson.agenda.updated');
    expect((auditCall?.metadata as Record<string, unknown>).length).toBe(28);
    // PII: raw agenda text must NEVER appear in audit metadata.
    expect(JSON.stringify(auditCall?.metadata)).not.toContain('Sara');
  });
});

describe('serializeLesson', () => {
  it('emits ISO strings, includes feedbackSource + agenda, and never leaks audioUrl', () => {
    const out = serializeLesson({
      id: 'les_1',
      studentId: 'stu_1',
      googleEventId: null,
      source: LessonSource.MANUAL,
      title: null,
      occurredAt: new Date('2026-05-01T10:00:00Z'),
      agenda: 'Review the conditional.',
      feedbackText: null,
      feedbackSource: 'TEXT' as never,
      audioUrl: null,
      transcriptionStatus: 'NONE' as never,
      transcriptionError: null,
      deletedAt: null,
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(out.occurredAt).toBe('2026-05-01T10:00:00.000Z');
    // agenda is part of the public response (free-text session plan).
    expect(out.agenda).toBe('Review the conditional.');
    // Phase 4: feedbackSource is part of the public response so the UI can
    // distinguish TEXT vs VOICE-derived feedback when Phase 5 lands.
    expect(out.feedbackSource).toBe('TEXT');
    // audioUrl stays private — the public API never includes the raw URL
    // even when it's set (the asset is signed/short-lived in Phase 5).
    expect(out).not.toHaveProperty('audioUrl');
    // Phase 5: hasAudio + transcriptionStatus are public so the UI can
    // surface the recorder state without exposing the storage path.
    expect(out.hasAudio).toBe(false);
    expect(out.transcriptionStatus).toBe('NONE');
  });
});
