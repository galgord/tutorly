import { BadRequestException } from '@nestjs/common';
import { GameStatus, GameType } from '@prisma/client';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { AuthedRequest } from '../auth/auth.guard';
import { GamesController, serializeGame } from './games.controller';
import type { GamesService } from './games.service';
import type { PrismaService } from '../prisma/prisma.service';

function fakeGame(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: (over.id as string) ?? 'gm_1',
    lessonId: 'les_1',
    type: (over.type as GameType) ?? GameType.FILL_BLANK,
    title: 'Fill-in-the-blank',
    status: (over.status as GameStatus) ?? GameStatus.GENERATING,
    questionPool: (over.questionPool as unknown) ?? [],
    poolSize: 30,
    locale: 'en',
    generationError: null,
    deletedAt: null,
    assignedAt: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    generationPromptHash: null,
  };
}

function makeController(
  opts: { tutorLocale?: string; tutorTeachingLanguage?: string | null } = {},
) {
  const games = {
    createAndEnqueue: vi.fn(),
    listForLesson: vi.fn(),
    findForTutor: vi.fn(),
    getForTutorOrFail: vi.fn(),
    editQuestions: vi.fn(),
    regenerateAll: vi.fn(),
    regenerateOneQuestion: vi.fn(),
    assign: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as GamesService;
  const audit = { record: vi.fn() } as unknown as AuditService;
  const prisma = {
    tutor: {
      findUnique: vi.fn().mockResolvedValue({
        locale: opts.tutorLocale ?? 'en',
        teachingLanguage:
          opts.tutorTeachingLanguage === undefined ? null : opts.tutorTeachingLanguage,
      }),
    },
  } as unknown as PrismaService;
  const ctrl = new GamesController(games, audit, prisma);
  return { ctrl, games, audit, prisma };
}

function fakeReq(): AuthedRequest {
  return {
    ip: '127.0.0.1',
    header: vi.fn((name: string) => (name === 'user-agent' ? 'agent/1.0' : undefined)),
  } as unknown as AuthedRequest;
}

function fakeRes(): Response {
  return { setHeader: vi.fn() } as unknown as Response;
}

const tutor = { id: 'tutor_a', email: 't@example.com' };

describe('GamesController.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 when body fails Zod parse', async () => {
    const { ctrl } = makeController();
    await expect(
      ctrl.create(tutor, 'les_1', { type: 'BAD_TYPE' }, fakeReq(), fakeRes()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults locale from tutor row when body omits it', async () => {
    const { ctrl, games } = makeController({ tutorLocale: 'pt' });
    vi.mocked(games.createAndEnqueue).mockResolvedValue({
      game: fakeGame() as never,
      breakerOpen: false,
    });
    await ctrl.create(tutor, 'les_1', { type: 'FILL_BLANK' }, fakeReq(), fakeRes());
    expect(games.createAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'pt', type: GameType.FILL_BLANK, lessonId: 'les_1' }),
    );
  });

  it('per-request locale overrides tutor preference', async () => {
    const { ctrl, games } = makeController({ tutorLocale: 'en' });
    vi.mocked(games.createAndEnqueue).mockResolvedValue({
      game: fakeGame() as never,
      breakerOpen: false,
    });
    await ctrl.create(tutor, 'les_1', { type: 'TIMED_QUIZ', locale: 'he' }, fakeReq(), fakeRes());
    expect(games.createAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'he', type: GameType.TIMED_QUIZ }),
    );
  });

  it('prefers tutor.teachingLanguage over tutor.locale when no per-request override', async () => {
    // A Hebrew-speaking Portuguese tutor: UI locale is he, but the
    // generated questions should be in Portuguese.
    const { ctrl, games } = makeController({
      tutorLocale: 'he',
      tutorTeachingLanguage: 'pt',
    });
    vi.mocked(games.createAndEnqueue).mockResolvedValue({
      game: fakeGame() as never,
      breakerOpen: false,
    });
    await ctrl.create(tutor, 'les_1', { type: 'FILL_BLANK' }, fakeReq(), fakeRes());
    expect(games.createAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'pt' }),
    );
  });

  it('falls back to tutor.locale when teachingLanguage is unset', async () => {
    const { ctrl, games } = makeController({
      tutorLocale: 'pt',
      tutorTeachingLanguage: null,
    });
    vi.mocked(games.createAndEnqueue).mockResolvedValue({
      game: fakeGame() as never,
      breakerOpen: false,
    });
    await ctrl.create(tutor, 'les_1', { type: 'FILL_BLANK' }, fakeReq(), fakeRes());
    expect(games.createAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'pt' }),
    );
  });

  it('sets x-ai-circuit-breaker header when breakerOpen', async () => {
    const { ctrl, games } = makeController();
    vi.mocked(games.createAndEnqueue).mockResolvedValue({
      game: fakeGame({ status: GameStatus.FAILED }) as never,
      breakerOpen: true,
    });
    const res = fakeRes();
    await ctrl.create(tutor, 'les_1', { type: 'FILL_BLANK' }, fakeReq(), res);
    expect(res.setHeader).toHaveBeenCalledWith('x-ai-circuit-breaker', 'open');
  });

  it('writes audit log with type, poolSize, locale, breakerOpen', async () => {
    const { ctrl, games, audit } = makeController();
    vi.mocked(games.createAndEnqueue).mockResolvedValue({
      game: fakeGame() as never,
      breakerOpen: false,
    });
    await ctrl.create(tutor, 'les_1', { type: 'FILL_BLANK', poolSize: 20 }, fakeReq(), fakeRes());
    const auditCall = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('game.generation.enqueued');
    expect(auditCall?.entityType).toBe('Game');
    expect(auditCall?.metadata).toMatchObject({
      type: GameType.FILL_BLANK,
      poolSize: 30, // game row's poolSize, since the mock returned the default
      locale: 'en',
      breakerOpen: false,
    });
  });
});

describe('GamesController.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes each game and returns the list response', async () => {
    const { ctrl, games } = makeController();
    vi.mocked(games.listForLesson).mockResolvedValue([
      fakeGame({ id: 'gm_1' }) as never,
      fakeGame({ id: 'gm_2', status: GameStatus.ASSIGNED }) as never,
    ]);
    const out = await ctrl.list(tutor, 'les_1');
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.id).toBe('gm_1');
    expect(out.items[1]!.status).toBe('ASSIGNED');
  });
});

describe('GamesController.get', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the serialized game', async () => {
    const { ctrl, games } = makeController();
    vi.mocked(games.getForTutorOrFail).mockResolvedValue(fakeGame() as never);
    const out = await ctrl.get(tutor, 'gm_1');
    expect(out.id).toBe('gm_1');
  });
});

describe('GamesController.edit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 on invalid body', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.edit(tutor, 'gm_1', { questions: [{ bad: 'shape' }] }, fakeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400 when neither title nor questions provided', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.edit(tutor, 'gm_1', {}, fakeReq())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards title update and audits', async () => {
    const { ctrl, games, audit } = makeController();
    vi.mocked(games.editQuestions).mockResolvedValue(fakeGame() as never);
    await ctrl.edit(tutor, 'gm_1', { title: 'Renamed' }, fakeReq());
    expect(games.editQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed', tutorId: 'tutor_a' }),
    );
    const auditCall = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('game.edited');
    expect((auditCall?.metadata as Record<string, unknown>).titleChanged).toBe(true);
  });
});

describe('GamesController.regenerate / regenerateOne / assign / remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('regenerate forwards + audits', async () => {
    const { ctrl, games, audit } = makeController();
    vi.mocked(games.regenerateAll).mockResolvedValue(fakeGame() as never);
    await ctrl.regenerate(tutor, 'gm_1', fakeReq());
    expect(games.regenerateAll).toHaveBeenCalled();
    expect(vi.mocked(audit.record).mock.calls[0]?.[0].action).toBe('game.regenerated');
  });

  it('regenerateOne 400s without questionId', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.regenerateOne(tutor, 'gm_1', {}, fakeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('regenerateOne forwards questionId + audits', async () => {
    const { ctrl, games, audit } = makeController();
    vi.mocked(games.regenerateOneQuestion).mockResolvedValue(fakeGame() as never);
    await ctrl.regenerateOne(tutor, 'gm_1', { questionId: 'q_42' }, fakeReq());
    expect(games.regenerateOneQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q_42' }),
    );
    const auditCall = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('game.question.regenerated');
    expect((auditCall?.metadata as Record<string, unknown>).questionId).toBe('q_42');
  });

  it('assign forwards + audits', async () => {
    const { ctrl, games, audit } = makeController();
    vi.mocked(games.assign).mockResolvedValue(fakeGame({ status: GameStatus.ASSIGNED }) as never);
    const out = await ctrl.assign(tutor, 'gm_1', fakeReq());
    expect(out.status).toBe('ASSIGNED');
    expect(vi.mocked(audit.record).mock.calls[0]?.[0].action).toBe('game.assigned');
  });

  it('remove returns 204 (void) + audits', async () => {
    const { ctrl, games, audit } = makeController();
    vi.mocked(games.softDelete).mockResolvedValue(
      fakeGame({ status: GameStatus.ARCHIVED }) as never,
    );
    await ctrl.remove(tutor, 'gm_1', fakeReq());
    expect(vi.mocked(audit.record).mock.calls[0]?.[0].action).toBe('game.deleted');
  });
});

describe('serializeGame', () => {
  it('produces ISO date strings and validated pool', () => {
    const out = serializeGame(
      fakeGame({
        questionPool: [
          {
            id: 'q_1',
            prompt: 'p',
            answer: 'a',
            distractors: [],
            acceptAlternates: [],
            topicTags: ['t'],
          },
        ],
      }) as never,
    );
    expect(out.createdAt).toBe('2026-05-01T00:00:00.000Z');
    expect(out.questionPool).toHaveLength(1);
  });

  it('returns [] when questionPool is malformed', () => {
    const out = serializeGame(fakeGame({ questionPool: 'not-an-array' }) as never);
    expect(out.questionPool).toEqual([]);
  });
});
