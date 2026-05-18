import {
  Body,
  Controller,
  ForbiddenException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ConfigService } from '../config/config.service';
import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentTutor, type CurrentTutorPayload } from '../auth/current-tutor.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Test-only seeder for the quota tables.
 *
 * Mounted ONLY when NODE_ENV !== 'production'. Lets Playwright drive a
 * tutor straight to (or past) the cap without firing 100+ real LLM jobs.
 *
 * Body:
 *   { monthlyGenerations?: number, monthlyWhisperMinutes?: number }
 *
 * Response:
 *   { ok: true, monthlyGenerations, monthlyWhisperMinutes }
 */
@Controller('__test__/quota')
@UseGuards(AuthGuard, CsrfGuard)
export class TestQuotaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Patch('set')
  async setCounters(
    @CurrentTutor() tutor: CurrentTutorPayload,
    @Body() body: { monthlyGenerations?: number; monthlyWhisperMinutes?: number } | undefined,
  ) {
    if (this.config.isProd()) {
      throw new ForbiddenException('Test routes disabled in production.');
    }
    const data: { monthlyGenerations?: number; monthlyWhisperMinutes?: number } = {};
    if (typeof body?.monthlyGenerations === 'number' && body.monthlyGenerations >= 0) {
      data.monthlyGenerations = Math.floor(body.monthlyGenerations);
    }
    if (typeof body?.monthlyWhisperMinutes === 'number' && body.monthlyWhisperMinutes >= 0) {
      data.monthlyWhisperMinutes = Math.floor(body.monthlyWhisperMinutes);
    }
    const updated = await this.prisma.tutor.update({
      where: { id: tutor.id },
      data,
      select: { monthlyGenerations: true, monthlyWhisperMinutes: true },
    });
    return {
      ok: true as const,
      monthlyGenerations: updated.monthlyGenerations,
      monthlyWhisperMinutes: updated.monthlyWhisperMinutes,
    };
  }
}
