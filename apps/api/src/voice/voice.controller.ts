import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ActorType, TranscriptionStatus } from '@prisma/client';
import {
  TranscriptionStatusResponseSchema,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_SECONDS,
  type Locale,
  type TranscriptionStatusResponse,
} from '@tutor-app/shared';
import { AuditService } from '../audit/audit.service';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { LessonService } from '../lessons/lesson.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { sniffAudioMime } from './audio-mime';
import { AudioStorageService } from './audio-storage.service';
import { WhisperJobQueue } from './whisper-job.queue';

interface MulterFile {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
}

/**
 * Phase 5 voice upload endpoints.
 *
 *   POST /lessons/:id/audio   multipart upload, kicks off Whisper job (202)
 *   GET  /lessons/:id/audio   poll transcription status (UI uses this)
 *
 * Tenant scoping: tutorId always from the session; every loader funnels
 * through LessonService.getLessonForTutorOrFail (404, not 401, on cross-
 * tenant). The audio file itself is namespaced under
 * `<STORAGE_DIR>/lessons/<lessonId>/` and only accessible via this api.
 */
@Controller('lessons/:id/audio')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class VoiceController {
  constructor(
    private readonly lessons: LessonService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: AudioStorageService,
    private readonly quota: QuotaService,
    @Inject(WhisperJobQueue) private readonly queue: WhisperJobQueue,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CsrfGuard)
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: VOICE_MAX_BYTES },
    }),
  )
  async upload(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') lessonId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: AuthedRequest,
  ): Promise<TranscriptionStatusResponse> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('audio file required.');
    }

    // 1. Tenant + lesson existence check first — refuse before reserving
    //    quota so a malformed request never burns a slot.
    const lesson = await this.lessons.getLessonForTutorOrFail({
      id: lessonId,
      tutorId: tutor.id,
    });

    // 2. Reject a re-upload while a transcription is already in flight —
    //    avoids races between two PENDING/TRANSCRIBING jobs for the same
    //    lesson and keeps quota accounting honest.
    if (
      lesson.transcriptionStatus === TranscriptionStatus.PENDING ||
      lesson.transcriptionStatus === TranscriptionStatus.TRANSCRIBING
    ) {
      throw new BadRequestException(
        'A transcription is already in progress for this lesson.',
      );
    }

    // 3. Read the client-reported duration from a form field (the
    //    multipart body can include other fields alongside the file).
    //    We sanity-check + re-cap server-side. Long-term we'd decode
    //    the audio to get the true duration; for v1 we trust + clamp.
    const declaredDurationRaw = readField(req, 'durationSeconds');
    const declaredDuration = parseDuration(declaredDurationRaw);
    if (!declaredDuration) {
      throw new BadRequestException(
        'durationSeconds form field required (positive integer, seconds).',
      );
    }
    if (declaredDuration > VOICE_MAX_DURATION_SECONDS) {
      throw new BadRequestException(
        `audio too long (${declaredDuration}s) — max ${VOICE_MAX_DURATION_SECONDS}s.`,
      );
    }
    const minutes = Math.max(1, Math.ceil(declaredDuration / 60));

    // 4. Server-side MIME sniff. NEVER trust file.mimetype — it's just
    //    whatever the browser put in the multipart envelope.
    const sniff = sniffAudioMime(file.buffer);
    if (!sniff.ok) {
      throw new BadRequestException(
        `unsupported audio format (detected: ${sniff.detected ?? 'unknown'}). ` +
          'Allowed: webm, ogg, mp4/m4a, wav.',
      );
    }

    // 5. Resolve locale for the Whisper hint. We use `tutor.locale` (the
    //    tutor's UI/recording language) — NOT `teachingLanguage`. A
    //    Hebrew-speaking Portuguese tutor records lesson feedback in
    //    Hebrew about Portuguese content; the prompt builder downstream
    //    is what makes the generated questions Portuguese.
    const tutorRow = await this.prisma.tutor.findUnique({
      where: { id: tutor.id },
      select: { locale: true },
    });
    const locale: Locale = ((tutorRow?.locale ?? tutor.locale) as Locale) ?? 'en';

    // 6. Reserve quota AFTER all input validation so refused-malformed
    //    requests never burn minutes. Refused-over-cap returns 403 with
    //    a typed body so the UI can show a specific banner.
    const reservation = await this.quota.reserveWhisperMinutes(tutor.id, minutes);
    if (!reservation.ok) {
      throw new ForbiddenException({
        error: 'whisper_quota_exceeded',
        cap: reservation.cap,
        used: reservation.used,
        resetsAt: reservation.resetsAt.toISOString(),
      });
    }

    // 7. Persist the audio under storage root + flip the lesson to PENDING.
    //    Use a sanitized filename derived from the lesson id + extension
    //    sniffed from the bytes (NOT the client-provided name).
    let relativePath: string;
    try {
      const saved = await this.storage.save({
        lessonId,
        fileName: `${lessonId}.${sniff.extension}`,
        bytes: file.buffer,
      });
      relativePath = saved.relativePath;
    } catch (err) {
      // Refund — the slot was reserved for an upload that never landed.
      await this.quota.refundWhisperMinutes(tutor.id, minutes);
      throw err;
    }

    const updated = await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        audioUrl: relativePath,
        transcriptionStatus: TranscriptionStatus.PENDING,
        transcriptionError: null,
      },
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'lesson.audio.uploaded',
      entityType: 'Lesson',
      entityId: lessonId,
      // Metadata: bytes + duration + locale — NEVER the raw audio path
      // or transcript text. PII boundary per CLAUDE.md.
      metadata: {
        bytes: file.size,
        durationSeconds: declaredDuration,
        minutesReserved: minutes,
        mime: sniff.mime,
        localeHint: locale,
      },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    // 8. Enqueue the Whisper job. If the breaker is open we still return
    //    202 (the request was *accepted*), but the lesson will already be
    //    FAILED via markBreakerFailure — refund the reservation.
    const result = this.queue.enqueue(lessonId, {
      tutorId: tutor.id,
      minutes,
      locale,
    });
    if (result.breakerOpen) {
      await this.quota.refundWhisperMinutes(tutor.id, minutes);
    }

    const refreshed = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    const finalRow = refreshed ?? updated;
    return TranscriptionStatusResponseSchema.parse({
      lessonId,
      transcriptionStatus: finalRow.transcriptionStatus,
      transcriptionError: finalRow.transcriptionError,
      hasAudio: !!finalRow.audioUrl,
    });
  }

  @Get()
  async status(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') lessonId: string,
  ): Promise<TranscriptionStatusResponse> {
    const lesson = await this.lessons.getLessonForTutorOrFail({
      id: lessonId,
      tutorId: tutor.id,
    });
    return TranscriptionStatusResponseSchema.parse({
      lessonId: lesson.id,
      transcriptionStatus: lesson.transcriptionStatus,
      transcriptionError: lesson.transcriptionError,
      hasAudio: !!lesson.audioUrl,
    });
  }
}

function readField(req: AuthedRequest, name: string): string | undefined {
  const body = (req as unknown as { body?: Record<string, unknown> }).body;
  const v = body?.[name];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function parseDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n);
}

function clientIp(req: AuthedRequest): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}
