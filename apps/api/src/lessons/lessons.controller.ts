import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActorType, FeedbackSource, LessonSource, type Lesson } from '@prisma/client';
import {
  CalendarMergeResponseSchema,
  CalendarRangeQuerySchema,
  CreateLessonRequestSchema,
  LessonListResponseSchema,
  LessonResponseSchema,
  ListLessonsQuerySchema,
  UpdateAgendaRequestSchema,
  UpdateFeedbackRequestSchema,
  type CalendarItem,
  type LessonResponse,
} from '@tutor-app/shared';
import { AuditService } from '../audit/audit.service';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { GoogleIntegrationService } from '../integrations/google/google-integration.service';
import { LessonService, type LessonWithStudent } from './lesson.service';

/**
 * Tutor-facing lessons endpoints.
 *
 * Every handler derives `tutorId` from the session and never trusts it from
 * the body or query. Single-lesson loads always funnel through
 * `LessonService.getLessonForTutorOrFail`.
 */
@Controller('lessons')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class LessonsController {
  constructor(
    private readonly lessons: LessonService,
    private readonly audit: AuditService,
    private readonly google: GoogleIntegrationService,
  ) {}

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<LessonResponse> {
    const parsed = CreateLessonRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const occurredAt = new Date(parsed.data.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('Invalid occurredAt timestamp.');
    }

    const source = parsed.data.googleEventId ? LessonSource.GOOGLE_CALENDAR : LessonSource.MANUAL;
    const lesson = await this.lessons.createLesson({
      studentId: parsed.data.studentId,
      tutorId: tutor.id,
      occurredAt,
      title: parsed.data.title ?? null,
      googleEventId: parsed.data.googleEventId ?? null,
      source,
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'lesson.created',
      entityType: 'Lesson',
      entityId: lesson.id,
      metadata: { source, hasGoogleEvent: !!parsed.data.googleEventId },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    return serializeLesson(lesson);
  }

  @Get('calendar')
  async calendar(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = CalendarRangeQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (from > to) throw new BadRequestException('`from` must be before `to`.');

    // Local lessons in the window — always tutor-scoped.
    const localLessons = await this.lessons.listLocalLessonsInRange({
      tutorId: tutor.id,
      from,
      to,
    });
    const localByGoogleId = new Map<string, LessonWithStudent>();
    const localWithoutGoogle: LessonWithStudent[] = [];
    for (const l of localLessons) {
      if (l.googleEventId) localByGoogleId.set(l.googleEventId, l);
      else localWithoutGoogle.push(l);
    }

    // Google events — typed disconnected/quota responses are quietly swallowed
    // here so the calendar still renders local lessons. The UI's status
    // endpoint already tells it whether to show a reconnect banner.
    const eventsResult = await this.google.listEventsForTutor({
      tutorId: tutor.id,
      from,
      to,
    });
    const googleEvents = eventsResult.ok ? eventsResult.events : [];

    const items: CalendarItem[] = [];
    const seenGoogleIds = new Set<string>();

    // Merge: start with the Google events, attaching local lesson refs when present.
    for (const ev of googleEvents) {
      const local = localByGoogleId.get(ev.id);
      seenGoogleIds.add(ev.id);
      items.push({
        source: local ? LessonSource.GOOGLE_CALENDAR : LessonSource.GOOGLE_CALENDAR,
        googleEventId: ev.id,
        title: local?.title ?? ev.title,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        hasLocalLesson: !!local,
        localLessonId: local?.id ?? null,
        studentId: local?.studentId ?? null,
        studentName: local?.student.name ?? null,
        calendarId: ev.calendarId,
        hasFeedback: hasFeedback(local),
      });
    }

    // Orphaned local lessons: have googleEventId but Google didn't return it
    // in the window (event was deleted). Per spec we treat as MANUAL for
    // surfacing, but the Lesson row keeps its googleEventId.
    for (const local of localByGoogleId.values()) {
      if (local.googleEventId && seenGoogleIds.has(local.googleEventId)) continue;
      items.push({
        source: LessonSource.MANUAL,
        googleEventId: local.googleEventId,
        title: local.title ?? '(untitled lesson)',
        startsAt: local.occurredAt.toISOString(),
        endsAt: null,
        hasLocalLesson: true,
        localLessonId: local.id,
        studentId: local.studentId,
        studentName: local.student.name,
        calendarId: null,
        hasFeedback: hasFeedback(local),
      });
    }

    // Purely manual lessons in the window.
    for (const local of localWithoutGoogle) {
      items.push({
        source: LessonSource.MANUAL,
        googleEventId: null,
        title: local.title ?? '(untitled lesson)',
        startsAt: local.occurredAt.toISOString(),
        endsAt: null,
        hasLocalLesson: true,
        localLessonId: local.id,
        studentId: local.studentId,
        studentName: local.student.name,
        calendarId: null,
        hasFeedback: hasFeedback(local),
      });
    }

    sortCalendarItems(items);

    return CalendarMergeResponseSchema.parse({ items });
  }

  @Get()
  async list(@CurrentTutor() tutor: CurrentTutorPayload, @Query() query: Record<string, unknown>) {
    const parsed = ListLessonsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const { items, total } = await this.lessons.listForStudent({
      studentId: parsed.data.studentId,
      tutorId: tutor.id,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    return LessonListResponseSchema.parse({
      items: items.map(serializeLesson),
      total,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
  }

  @Get(':id')
  async get(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
  ): Promise<LessonResponse> {
    const lesson = await this.lessons.getLessonForTutorOrFail({ id, tutorId: tutor.id });
    return serializeLessonWithStudent(lesson);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async remove(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const lesson = await this.lessons.softDelete({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'lesson.deleted',
      entityType: 'Lesson',
      entityId: lesson.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async restore(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<LessonResponse> {
    const lesson = await this.lessons.restore({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'lesson.restored',
      entityType: 'Lesson',
      entityId: lesson.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return serializeLesson(lesson);
  }

  @Patch(':id/feedback')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async setFeedback(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<LessonResponse> {
    const parsed = UpdateFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const lesson = await this.lessons.updateFeedback({
      id,
      tutorId: tutor.id,
      feedbackText: parsed.data.feedbackText,
      source: FeedbackSource.TEXT,
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'lesson.feedback.updated',
      entityType: 'Lesson',
      entityId: lesson.id,
      // Length only — never the body itself (PII).
      metadata: { length: parsed.data.feedbackText.length, source: 'TEXT' },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    // Return the lesson WITH its student so the client's cache keeps the
    // join data (the editor does setQueryData with this response).
    const withStudent = await this.lessons.getLessonForTutorOrFail({ id, tutorId: tutor.id });
    return serializeLessonWithStudent(withStudent);
  }

  /**
   * Persist the lesson's free-text agenda/plan. Allowed at any time —
   * before the session (a plan) or after (a record of what was covered),
   * unlike `setFeedback` which is gated on `occurredAt`.
   */
  @Patch(':id/agenda')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async setAgenda(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<LessonResponse> {
    const parsed = UpdateAgendaRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const lesson = await this.lessons.updateAgenda({
      id,
      tutorId: tutor.id,
      agenda: parsed.data.agenda,
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'lesson.agenda.updated',
      entityType: 'Lesson',
      entityId: lesson.id,
      // Length only — never the body itself (PII).
      metadata: { length: parsed.data.agenda.length },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    // Return the lesson WITH its student so the client cache keeps join data.
    const withStudent = await this.lessons.getLessonForTutorOrFail({ id, tutorId: tutor.id });
    return serializeLessonWithStudent(withStudent);
  }
}

export function serializeLesson(l: Lesson): LessonResponse {
  return LessonResponseSchema.parse({
    id: l.id,
    studentId: l.studentId,
    source: l.source,
    title: l.title,
    occurredAt: l.occurredAt.toISOString(),
    googleEventId: l.googleEventId,
    agenda: l.agenda,
    feedbackText: l.feedbackText,
    feedbackSource: l.feedbackSource,
    transcriptionStatus: l.transcriptionStatus,
    transcriptionError: l.transcriptionError,
    hasAudio: !!l.audioUrl,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    deletedAt: l.deletedAt ? l.deletedAt.toISOString() : null,
  });
}

export function serializeLessonWithStudent(l: LessonWithStudent): LessonResponse {
  return LessonResponseSchema.parse({
    id: l.id,
    studentId: l.studentId,
    studentName: l.student.name,
    source: l.source,
    title: l.title,
    occurredAt: l.occurredAt.toISOString(),
    googleEventId: l.googleEventId,
    agenda: l.agenda,
    feedbackText: l.feedbackText,
    feedbackSource: l.feedbackSource,
    transcriptionStatus: l.transcriptionStatus,
    transcriptionError: l.transcriptionError,
    hasAudio: !!l.audioUrl,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    deletedAt: l.deletedAt ? l.deletedAt.toISOString() : null,
  });
}

function sortCalendarItems(items: CalendarItem[]): void {
  const now = Date.now();
  items.sort((a, b) => {
    const at = new Date(a.startsAt).getTime();
    const bt = new Date(b.startsAt).getTime();
    const aFuture = at >= now;
    const bFuture = bt >= now;
    // Past events grouped first, sorted desc (most recent first).
    // Future events grouped after, sorted asc (soonest first).
    if (aFuture !== bFuture) return aFuture ? 1 : -1;
    return aFuture ? at - bt : bt - at;
  });
}

function clientIp(req: AuthedRequest): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}

/** A lesson "has feedback" once its feedbackText is non-empty. */
function hasFeedback(local: LessonWithStudent | undefined | null): boolean {
  return !!local?.feedbackText && local.feedbackText.trim().length > 0;
}
