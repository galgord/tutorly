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
import { ActorType } from '@prisma/client';
import {
  CreateStudentRequestSchema,
  ListStudentsQuerySchema,
  RotateTokenResponseSchema,
  StudentListResponseSchema,
  StudentResponseSchema,
  UpdateStudentRequestSchema,
  type StudentResponse,
} from '@tutor-app/shared';
import { AuditService } from '../audit/audit.service';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { StudentService } from './student.service';

/**
 * Tutor-facing student CRUD. Every handler derives `tutorId` from the session
 * via `CurrentTutor` and passes it down so the service layer can enforce
 * tenant isolation. `tutorId` is NEVER read from the request body or query.
 */
@Controller('students')
@UseGuards(AuthGuard)
// Slightly tighter than the global 60/min for state-changing student ops.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class StudentsController {
  constructor(
    private readonly students: StudentService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<StudentResponse> {
    const parsed = CreateStudentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const student = await this.students.create({
      tutorId: tutor.id,
      name: parsed.data.name,
      notes: parsed.data.notes,
      nativeLanguage: parsed.data.nativeLanguage,
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'student.created',
      entityType: 'Student',
      entityId: student.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    return serializeStudent(student);
  }

  @Get()
  async list(@CurrentTutor() tutor: CurrentTutorPayload, @Query() query: Record<string, unknown>) {
    const parsed = ListStudentsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const { items, total } = await this.students.list({
      tutorId: tutor.id,
      locale: tutor.locale,
      q: parsed.data.q,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });

    return StudentListResponseSchema.parse({
      items: items.map(serializeStudent),
      total,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
  }

  @Get(':id')
  async get(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
  ): Promise<StudentResponse> {
    const student = await this.students.getForTutorOrFail({ id, tutorId: tutor.id });
    return serializeStudent(student);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  async update(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<StudentResponse> {
    const parsed = UpdateStudentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const student = await this.students.update({
      id,
      tutorId: tutor.id,
      name: parsed.data.name,
      notes: parsed.data.notes,
      nativeLanguage: parsed.data.nativeLanguage,
    });

    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'student.updated',
      entityType: 'Student',
      entityId: student.id,
      metadata: { fields: Object.keys(parsed.data) },
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });

    return serializeStudent(student);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async remove(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const student = await this.students.softDelete({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'student.deleted',
      entityType: 'Student',
      entityId: student.id,
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
  ): Promise<StudentResponse> {
    const student = await this.students.restore({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'student.restored',
      entityType: 'Student',
      entityId: student.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return serializeStudent(student);
  }

  @Post(':id/rotate-token')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async rotateToken(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    const student = await this.students.rotateToken({ id, tutorId: tutor.id });
    await this.audit.record({
      tutorId: tutor.id,
      actorType: ActorType.TUTOR,
      action: 'student.token.rotated',
      entityType: 'Student',
      entityId: student.id,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') ?? null,
    });
    return RotateTokenResponseSchema.parse({
      shareToken: student.shareToken,
      shareTokenRotatedAt: student.shareTokenRotatedAt.toISOString(),
    });
  }
}

@Controller('trash/students')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class TrashStudentsController {
  constructor(private readonly students: StudentService) {}

  @Get()
  async list(@CurrentTutor() tutor: CurrentTutorPayload, @Query() query: Record<string, unknown>) {
    const parsed = ListStudentsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const { items, total } = await this.students.listTrash({
      tutorId: tutor.id,
      locale: tutor.locale,
      q: parsed.data.q,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });

    return StudentListResponseSchema.parse({
      items: items.map(serializeStudent),
      total,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
  }
}

export function serializeStudent(s: {
  id: string;
  name: string;
  notes: string | null;
  nativeLanguage: string | null;
  shareToken: string;
  shareTokenRotatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): StudentResponse {
  return StudentResponseSchema.parse({
    id: s.id,
    name: s.name,
    notes: s.notes,
    nativeLanguage: s.nativeLanguage,
    shareToken: s.shareToken,
    shareTokenRotatedAt: s.shareTokenRotatedAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null,
  });
}

function clientIp(req: AuthedRequest): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}
