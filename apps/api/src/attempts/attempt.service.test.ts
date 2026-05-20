import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameStatus, GameType, type Student } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { makePrismaMock } from '../test/prisma-mock';
import { AttemptService, type Selector } from './attempt.service';
import { selectAttemptQuestions } from './adaptive-selector';
import { QuestionReviewService } from './question-review.service';
import { seededRng } from './question-sampler';
import { StudentGameProgressService } from './student-game-progress.service';

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    ATTEMPT_ABANDON_AFTER_HOURS: 24,
    FILL_BLANK_SESSION_SIZE: 10,
    TIMED_QUIZ_SESSION_SIZE: 20,
    LEVEL_ADVANCE_THRESHOLD: 0.8,
    LEVEL_HOLD_FLOOR: 0.5,
    LEVEL_NUDGE_EVERY_N: 3,
    LEVEL_MIN_SAMPLE: 3,
    LEVEL_ALLOW_DOWN: false,
    SR_BOX_INTERVALS_DAYS: [0, 1, 3, 7, 16],
    REVIEW_FRACTION: 0.3,
  };
  const merged = { ...defaults, ...overrides };
  return { get: vi.fn((k: string) => merged[k]), isProd: () => false } as unknown as ConfigService;
}

/** Default deterministic selector for tests (seeded RNG). */
const seededSelector: Selector = (input) =>
  selectAttemptQuestions({ ...input, rng: seededRng(42) });

/** Stub progress service: level 1, nothing seen, writes are no-ops. */
function makeProgressStub(
  over: Partial<{ level: number; seen: string[]; nudgeCounter: number }> = {},
): StudentGameProgressService {
  return {
    loadState: vi.fn(async () => ({
      level: over.level ?? 1,
      seen: over.seen ?? [],
      nudgeCounter: over.nudgeCounter ?? 0,
    })),
    applyFinish: vi.fn(async () => undefined),
  } as unknown as StudentGameProgressService;
}

/** Stub review service: nothing due, write-back is a no-op. */
function makeReviewStub(due: string[] = []): QuestionReviewService {
  return {
    dueReviews: vi.fn(async () => due),
    recordResults: vi.fn(async () => undefined),
  } as unknown as QuestionReviewService;
}

function fakeStudent(over: Partial<Student> = {}): Student {
  return {
    id: 'stu_1',
    tutorId: 'tutor_a',
    name: 'Sara',
    notes: null,
    shareToken: 'tok',
    shareTokenRotatedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Student;
}

function fakeGame(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'game_1',
    lessonId: 'lesson_1',
    type: GameType.FILL_BLANK,
    title: 'Practice',
    status: GameStatus.ASSIGNED,
    questionPool: [
      {
        id: 'q1',
        prompt: 'She ___ to school.',
        answer: 'walks',
        distractors: [],
        acceptAlternates: ['runs'],
        topicTags: ['verbs'],
      },
      {
        id: 'q2',
        prompt: 'He ___ a book.',
        answer: 'reads',
        distractors: [],
        acceptAlternates: [],
        topicTags: [],
      },
    ],
    poolSize: 2,
    locale: 'en',
    generationError: null,
    deletedAt: null,
    assignedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    lesson: { deletedAt: null, student: { id: 'stu_1' } },
    ...over,
  };
}

function makeService(opts: {
  prisma?: PrismaService;
  selector?: Selector;
  config?: ConfigService;
  progress?: StudentGameProgressService;
  review?: QuestionReviewService;
} = {}) {
  return new AttemptService(
    opts.prisma ?? makePrismaMock(),
    opts.config ?? makeConfig(),
    opts.selector ?? seededSelector,
    opts.progress ?? makeProgressStub(),
    opts.review ?? makeReviewStub(),
  );
}

describe('AttemptService.startAttempt', () => {
  let prisma: PrismaService;
  let service: AttemptService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService({ prisma });
  });

  it('404s when game does not exist', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      service.startAttempt({ student: fakeStudent(), gameId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when game belongs to another student (token mismatch)', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeGame({ lesson: { deletedAt: null, student: { id: 'stu_OTHER' } } }),
    );
    await expect(
      service.startAttempt({ student: fakeStudent(), gameId: 'g' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when game is not ASSIGNED', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeGame({ status: GameStatus.DRAFT }),
    );
    await expect(
      service.startAttempt({ student: fakeStudent(), gameId: 'g' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the parent lesson is soft-deleted', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeGame({ lesson: { deletedAt: new Date(), student: { id: 'stu_1' } } }),
    );
    await expect(
      service.startAttempt({ student: fakeStudent(), gameId: 'g' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s when game has empty question pool', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeGame({ questionPool: [] }),
    );
    await expect(
      service.startAttempt({ student: fakeStudent(), gameId: 'g' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an attempt with sampled questions persisted in header', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(fakeGame());
    (prisma.attempt.create as ReturnType<typeof vi.fn>).mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'att_1',
          ...data,
          score: 0,
          livesLost: 0,
          finishedAt: null,
          createdAt: new Date(),
        }),
    );

    const out = await service.startAttempt({ student: fakeStudent(), gameId: 'g' });
    expect(out.questions).toHaveLength(2);
    expect(out.livesAllowed).toBe(0);
    expect(out.perQuestionSeconds).toBe(0);
    // The persisted header must carry sampledIds + keys (server-known
    // truth so later PATCHes can verify + score).
    const created = (prisma.attempt.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const header = created.data.questionResults as {
      sampledIds: string[];
      keys: Record<string, { answer: string }>;
    };
    expect(header.sampledIds).toHaveLength(2);
    expect(header.keys[header.sampledIds[0]!]).toMatchObject({ answer: expect.any(String) });
  });

  it('TIMED_QUIZ start emits lives + per-question seconds', async () => {
    (prisma.game.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeGame({
        type: GameType.TIMED_QUIZ,
        questionPool: [
          {
            id: 'q1',
            prompt: 'Capital of France?',
            answer: 'Paris',
            distractors: ['Lyon', 'Marseille', 'Nice'],
            acceptAlternates: [],
            topicTags: [],
          },
        ],
      }),
    );
    (prisma.attempt.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'att_1',
      gameId: 'game_1',
      studentId: 'stu_1',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: {},
      createdAt: new Date(),
    });
    const out = await service.startAttempt({ student: fakeStudent(), gameId: 'game_1' });
    expect(out.livesAllowed).toBe(3);
    expect(out.perQuestionSeconds).toBe(20);
  });
});

describe('AttemptService.submitAnswer (FILL_BLANK)', () => {
  let prisma: PrismaService;
  let service: AttemptService;
  const header = (extras: Partial<Record<string, unknown>> = {}) => ({
    sampledIds: ['q1'],
    keys: {
      q1: {
        answer: 'walks',
        acceptAlternates: ['runs'],
        distractors: [],
        prompt: 'She ___ to school.',
        topicTags: ['verbs'],
      },
    },
    results: [],
    gameType: GameType.FILL_BLANK,
    locale: 'en',
    livesAllowed: 0,
    perQuestionSeconds: 0,
    ...extras,
  });

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService({ prisma });
  });

  it('404 when attempt does not exist', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      service.submitAnswer({
        student: fakeStudent(),
        attemptId: 'a',
        questionId: 'q1',
        rawAnswer: 'walks',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when attempt belongs to a different student (cross-token)', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_OTHER',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: header(),
      createdAt: new Date(),
    });
    await expect(
      service.submitAnswer({
        student: fakeStudent(),
        attemptId: 'a',
        questionId: 'q1',
        rawAnswer: 'walks',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when questionId is NOT in this attempt sampled set', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: header(),
      createdAt: new Date(),
    });
    await expect(
      service.submitAnswer({
        student: fakeStudent(),
        attemptId: 'a',
        questionId: 'q_other',
        rawAnswer: 'walks',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('correct answer → score+1, gameOver=true (only one question)', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: header(),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      rawAnswer: 'WALKS',
    });
    expect(r.record.correct).toBe(true);
    expect(r.scoreSoFar).toBe(1);
    expect(r.gameOver).toBe(true);
  });

  it('wrong answer → score unchanged, recorded as incorrect', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: header(),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      rawAnswer: 'jumps',
    });
    expect(r.record.correct).toBe(false);
    expect(r.scoreSoFar).toBe(0);
  });

  it('alternate answer (runs) accepted via acceptAlternates', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: header(),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      rawAnswer: 'runs',
    });
    expect(r.record.correct).toBe(true);
  });

  it('IDEMPOTENT: re-submitting the same question returns existing result without double-counting', async () => {
    const existingRecord = {
      questionId: 'q1',
      prompt: 'She ___ to school.',
      correct: true,
      rawAnswer: 'walks',
      normalizedAnswer: 'walks',
      expectedAnswer: 'walks',
      answeredAt: new Date('2026-05-18T10:00:00Z').toISOString(),
      topicTags: ['verbs'],
    };
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 1,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: header({ results: [existingRecord] }),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      rawAnswer: 'jumps', // would be wrong, but ignored — idempotent reply
    });
    expect(r.record.correct).toBe(true);
    expect(r.scoreSoFar).toBe(1);
    // No update call — idempotent path skips it.
    expect((prisma.attempt.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('400 when attempt already finished', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: new Date(),
      questionResults: header(),
      createdAt: new Date(),
    });
    await expect(
      service.submitAnswer({
        student: fakeStudent(),
        attemptId: 'a',
        questionId: 'q1',
        rawAnswer: 'walks',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Hebrew nikud-aware scoring: with vs without nikud both correct', async () => {
    const hebHeader = {
      sampledIds: ['qh'],
      keys: {
        qh: {
          answer: 'שָׁלוֹם',
          acceptAlternates: [],
          distractors: [],
          prompt: 'Greet someone:',
          topicTags: [],
        },
      },
      results: [],
      gameType: GameType.FILL_BLANK,
      locale: 'he' as const,
      livesAllowed: 0,
      perQuestionSeconds: 0,
    };
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: hebHeader,
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'qh',
      rawAnswer: 'שלום', // no nikud
    });
    expect(r.record.correct).toBe(true);
  });
});

describe('AttemptService.submitAnswer (TIMED_QUIZ)', () => {
  let prisma: PrismaService;
  let service: AttemptService;
  const headerTimed = (extras: Partial<Record<string, unknown>> = {}) => ({
    sampledIds: ['q1', 'q2', 'q3'],
    keys: {
      q1: {
        answer: 'Paris',
        acceptAlternates: [],
        distractors: ['Lyon', 'Marseille', 'Nice'],
        prompt: 'Capital of France?',
        topicTags: ['geo'],
      },
      q2: {
        answer: 'Madrid',
        acceptAlternates: [],
        distractors: ['Lisbon', 'Barcelona', 'Bilbao'],
        prompt: 'Capital of Spain?',
        topicTags: ['geo'],
      },
      q3: {
        answer: 'Rome',
        acceptAlternates: [],
        distractors: ['Milan', 'Naples', 'Turin'],
        prompt: 'Capital of Italy?',
        topicTags: ['geo'],
      },
    },
    results: [],
    gameType: GameType.TIMED_QUIZ,
    locale: 'en',
    livesAllowed: 3,
    perQuestionSeconds: 20,
    choicesByQuestion: {
      q1: ['Paris', 'Lyon', 'Marseille', 'Nice'],
      q2: ['Lisbon', 'Madrid', 'Barcelona', 'Bilbao'],
      q3: ['Rome', 'Milan', 'Naples', 'Turin'],
    },
    ...extras,
  });

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService({ prisma });
  });

  it('TIMED_QUIZ correct choice → score+1, lives unchanged', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: headerTimed(),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      choiceIndex: 0, // "Paris"
    });
    expect(r.record.correct).toBe(true);
    expect(r.scoreSoFar).toBe(1);
    expect(r.livesRemaining).toBe(3);
    expect(r.gameOver).toBe(false);
  });

  it('TIMED_QUIZ wrong choice → score same, lives -1', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 5,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: headerTimed(),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      choiceIndex: 1, // "Lyon"
    });
    expect(r.record.correct).toBe(false);
    expect(r.scoreSoFar).toBe(5);
    expect(r.livesRemaining).toBe(2);
  });

  it('TIMED_QUIZ third wrong → gameOver=true', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 2,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: headerTimed({
        results: [
          {
            questionId: 'q1',
            prompt: 'Capital of France?',
            correct: false,
            rawAnswer: 'Lyon',
            normalizedAnswer: 'lyon',
            expectedAnswer: 'Paris',
            answeredAt: new Date().toISOString(),
            topicTags: [],
            choiceIndex: 1,
            timedOut: false,
          },
          {
            questionId: 'q2',
            prompt: 'Capital of Spain?',
            correct: false,
            rawAnswer: 'Barcelona',
            normalizedAnswer: 'barcelona',
            expectedAnswer: 'Madrid',
            answeredAt: new Date().toISOString(),
            topicTags: [],
            choiceIndex: 2,
            timedOut: false,
          },
        ],
      }),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q3',
      choiceIndex: 1, // wrong
    });
    expect(r.livesRemaining).toBe(0);
    expect(r.gameOver).toBe(true);
  });

  it('TIMED_QUIZ timeout counts as wrong, costs a life', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: headerTimed(),
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await service.submitAnswer({
      student: fakeStudent(),
      attemptId: 'a',
      questionId: 'q1',
      timedOut: true,
    });
    expect(r.record.correct).toBe(false);
    expect(r.record.timedOut).toBe(true);
    expect(r.record.choiceIndex).toBe(-1);
    expect(r.livesRemaining).toBe(2);
  });

  it('TIMED_QUIZ rejects missing choiceIndex (and not timed out)', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: headerTimed(),
      createdAt: new Date(),
    });
    await expect(
      service.submitAnswer({
        student: fakeStudent(),
        attemptId: 'a',
        questionId: 'q1',
        rawAnswer: 'Paris', // wrong-shape input for a TIMED_QUIZ
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TIMED_QUIZ rejects out-of-range choiceIndex', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 0,
      livesLost: 0,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: headerTimed(),
      createdAt: new Date(),
    });
    await expect(
      service.submitAnswer({
        student: fakeStudent(),
        attemptId: 'a',
        questionId: 'q1',
        choiceIndex: 7, // only 4 choices were frozen
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AttemptService.finishAttempt', () => {
  let prisma: PrismaService;
  let service: AttemptService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService({ prisma });
    (prisma.attempt.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _max: { score: 3 },
    });
  });

  it('404 when attempt missing', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      service.finishAttempt({ student: fakeStudent(), attemptId: 'a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('first finish sets finishedAt + returns summary', async () => {
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 5,
      livesLost: 1,
      startedAt: new Date(),
      finishedAt: null,
      questionResults: {
        sampledIds: ['q1', 'q2', 'q3'],
        keys: {},
        results: [],
        gameType: GameType.FILL_BLANK,
        locale: 'en',
        livesAllowed: 0,
        perQuestionSeconds: 0,
      },
      createdAt: new Date(),
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'a',
        studentId: 'stu_1',
        gameId: 'g',
        score: 5,
        livesLost: 1,
        startedAt: new Date(),
        finishedAt: data.finishedAt as Date,
        questionResults: {},
        createdAt: new Date(),
      }),
    );
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.attempt.finishedAt).toBeInstanceOf(Date);
    expect(r.totalQuestions).toBe(3);
    expect(r.bestEver).toBe(3);
  });

  it('IDEMPOTENT: re-finishing returns same summary without re-updating', async () => {
    const finished = new Date('2026-05-18T11:00:00Z');
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      studentId: 'stu_1',
      gameId: 'g',
      score: 5,
      livesLost: 1,
      startedAt: new Date(),
      finishedAt: finished,
      questionResults: {
        sampledIds: ['q1'],
        keys: {},
        results: [],
        gameType: GameType.FILL_BLANK,
        locale: 'en',
        livesAllowed: 0,
        perQuestionSeconds: 0,
      },
      createdAt: new Date(),
    });
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.attempt.finishedAt).toEqual(finished);
    // Update never called — idempotent reply.
    expect((prisma.attempt.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('AttemptService.listAssignedGamesForStudent', () => {
  it('returns empty when no games assigned', async () => {
    const prisma = makePrismaMock();
    (prisma.game.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const service = makeService({ prisma });
    const out = await service.listAssignedGamesForStudent(fakeStudent());
    expect(out).toEqual([]);
  });

  it('zips per-game last-played + best-score onto each game', async () => {
    const prisma = makePrismaMock();
    (prisma.game.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'g1', type: GameType.FILL_BLANK, title: 'A', locale: 'en', poolSize: 10 },
      { id: 'g2', type: GameType.TIMED_QUIZ, title: 'B', locale: 'he', poolSize: 20 },
    ]);
    (prisma.attempt.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { gameId: 'g1', _max: { finishedAt: new Date('2026-05-10'), score: 8 } },
    ]);
    (prisma.studentGameProgress.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { gameId: 'g1', currentLevel: 3 },
    ]);
    const service = makeService({ prisma });
    const out = await service.listAssignedGamesForStudent(fakeStudent());
    expect(out[0]?.bestScore).toBe(8);
    expect(out[0]?.currentLevel).toBe(3);
    expect(out[1]?.currentLevel).toBe(1); // no progress row → default level 1
    expect(out[1]?.bestScore).toBeNull();
    expect(out[1]?.lastPlayedAt).toBeNull();
  });
});

describe('AttemptService.freezeChoices', () => {
  it('skips for FILL_BLANK', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      questionResults: {
        sampledIds: ['q1'],
        keys: { q1: { answer: 'x', distractors: [], acceptAlternates: [], prompt: 'p', topicTags: [] } },
        results: [],
        gameType: GameType.FILL_BLANK,
        locale: 'en',
        livesAllowed: 0,
        perQuestionSeconds: 0,
      },
    });
    const service = makeService({ prisma });
    await service.freezeChoices('a');
    expect((prisma.attempt.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('shuffles + caps choices at 4 for TIMED_QUIZ', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a',
      questionResults: {
        sampledIds: ['q1'],
        keys: {
          q1: {
            answer: 'Paris',
            distractors: ['Lyon', 'Marseille', 'Nice', 'Bordeaux', 'Toulouse'],
            acceptAlternates: [],
            prompt: 'Capital',
            topicTags: [],
          },
        },
        results: [],
        gameType: GameType.TIMED_QUIZ,
        locale: 'en',
        livesAllowed: 3,
        perQuestionSeconds: 20,
      },
    });
    const service = makeService({ prisma });
    await service.freezeChoices('a');
    const call = (prisma.attempt.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const persisted = call.data.questionResults as {
      choicesByQuestion: Record<string, string[]>;
    };
    expect(persisted.choicesByQuestion.q1).toHaveLength(4);
    // Must contain the correct answer.
    expect(persisted.choicesByQuestion.q1).toContain('Paris');
  });
});

describe('AttemptService.finishAbandoned', () => {
  it('updates attempts older than ATTEMPT_ABANDON_AFTER_HOURS', async () => {
    const prisma = makePrismaMock();
    (prisma.attempt.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });
    const config = makeConfig({ ATTEMPT_ABANDON_AFTER_HOURS: 12 });
    const service = makeService({ prisma, config });
    const now = new Date('2026-05-18T12:00:00Z');
    const count = await service.finishAbandoned(now);
    expect(count).toBe(3);
    const call = (prisma.attempt.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.finishedAt).toEqual(null);
    expect((call.where.startedAt as { lt: Date }).lt.getTime()).toBe(
      new Date('2026-05-18T00:00:00Z').getTime(),
    );
    expect(call.data.finishedAt).toEqual(now);
  });
});

// ---- Phase 12: adaptive difficulty + level write-back ------------------

describe('AttemptService.finishAttempt — Phase 12 level outcome', () => {
  const res = (questionId: string, correct: boolean) => ({
    questionId,
    prompt: 'p',
    correct,
    rawAnswer: 'x',
    normalizedAnswer: 'x',
    expectedAnswer: 'x',
    answeredAt: new Date('2026-05-20T10:00:00Z').toISOString(),
    topicTags: [],
  });

  const finishHeader = (over: Partial<Record<string, unknown>> = {}) => ({
    sampledIds: ['q1', 'q2', 'q3', 'q4'],
    keys: {},
    results: [res('q1', true), res('q2', true), res('q3', true), res('q4', true)],
    gameType: GameType.FILL_BLANK,
    locale: 'en',
    livesAllowed: 0,
    perQuestionSeconds: 0,
    level: 2,
    bucketByQuestion: { q1: 'new', q2: 'new', q3: 'new', q4: 'new' },
    ...over,
  });

  const finishedAttempt = (header: unknown, over: Partial<Record<string, unknown>> = {}) => ({
    id: 'a',
    studentId: 'stu_1',
    gameId: 'game_1',
    score: 4,
    livesLost: 0,
    startedAt: new Date(),
    finishedAt: null,
    questionResults: header,
    createdAt: new Date(),
    ...over,
  });

  function setup(over: { progressLevel?: number; nudgeCounter?: number } = {}) {
    const prisma = makePrismaMock();
    const applyFinish = vi.fn(async () => undefined);
    const recordResults = vi.fn(async () => undefined);
    const progress = {
      loadState: vi.fn(async () => ({
        level: over.progressLevel ?? 2,
        seen: [],
        nudgeCounter: over.nudgeCounter ?? 0,
      })),
      applyFinish,
    } as unknown as StudentGameProgressService;
    const review = {
      dueReviews: vi.fn(async () => []),
      recordResults,
    } as unknown as QuestionReviewService;
    const service = makeService({ prisma, progress, review });
    (prisma.attempt.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _max: { score: 0 },
    });
    (prisma.attempt.update as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => finishedAttempt(data.questionResults, { finishedAt: data.finishedAt }),
    );
    return { prisma, service, applyFinish, recordResults };
  }

  it('advances the level on a high-accuracy play and writes it back once', async () => {
    const { prisma, service, applyFinish, recordResults } = setup({ progressLevel: 2 });
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      finishedAttempt(finishHeader()),
    );
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.level).toBe(2);
    expect(r.nextLevel).toBe(3);
    expect(r.leveledUp).toBe(true);
    expect(applyFinish).toHaveBeenCalledTimes(1);
    expect(applyFinish).toHaveBeenCalledWith(
      expect.objectContaining({ newLevel: 3, lastLevelDelta: 1, lastAccuracy: 1 }),
    );
    // Spaced-repetition write-back runs in the same transaction with the answers.
    expect(recordResults).toHaveBeenCalledTimes(1);
    expect(recordResults).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          { questionId: 'q1', correct: true },
          { questionId: 'q2', correct: true },
          { questionId: 'q3', correct: true },
          { questionId: 'q4', correct: true },
        ],
      }),
    );
    // The attempt header is stamped with levelAfter so re-finish is exact.
    const updateData = (prisma.attempt.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect((updateData.questionResults as { levelAfter: number }).levelAfter).toBe(3);
  });

  it('does NOT raise the level on a struggling play', async () => {
    const { prisma, service, applyFinish } = setup({ progressLevel: 2 });
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      finishedAttempt(
        finishHeader({ results: [res('q1', true), res('q2', false), res('q3', false), res('q4', false)] }),
      ),
    );
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.nextLevel).toBe(2);
    expect(r.leveledUp).toBe(false);
    expect(applyFinish).toHaveBeenCalledWith(
      expect.objectContaining({ newLevel: 2, lastLevelDelta: 0 }),
    );
  });

  it('computes accuracy over NON-REVIEW slots only (reviews never inflate/deflate level)', async () => {
    const { prisma, service } = setup({ progressLevel: 2 });
    // q1 is a review and WRONG; the three new questions are all correct.
    // Over all answers that's 3/4 = 0.75 (< 0.8, no advance); over non-review
    // it's 3/3 = 1.0 (advance). Advancing proves reviews are excluded.
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      finishedAttempt(
        finishHeader({
          bucketByQuestion: { q1: 'review', q2: 'new', q3: 'new', q4: 'new' },
          results: [res('q1', false), res('q2', true), res('q3', true), res('q4', true)],
        }),
      ),
    );
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.nextLevel).toBe(3);
    expect(r.leveledUp).toBe(true);
  });

  it('IDEMPOTENT: re-finishing an already-finished attempt does not advance again', async () => {
    const { prisma, service, applyFinish, recordResults } = setup({ progressLevel: 2 });
    // Attempt already finished, header carries the stamped levelAfter = 3.
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      finishedAttempt(finishHeader({ levelAfter: 3 }), { finishedAt: new Date('2026-05-20T11:00:00Z') }),
    );
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.level).toBe(2);
    expect(r.nextLevel).toBe(3); // reconstructed from header, not recomputed
    expect(applyFinish).not.toHaveBeenCalled();
    expect(recordResults).not.toHaveBeenCalled();
    expect(prisma.attempt.update).not.toHaveBeenCalled();
  });

  it('cron-finished attempt (no levelAfter stamp) reports no level change and writes nothing', async () => {
    const { prisma, service, applyFinish, recordResults } = setup({ progressLevel: 2 });
    // The abandoned-attempt cron set finishedAt via bulk updateMany but never
    // stamped levelAfter — so a later manual finish must NOT write back.
    (prisma.attempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      finishedAttempt(finishHeader(), { finishedAt: new Date('2026-05-20T12:00:00Z') }),
    );
    const r = await service.finishAttempt({ student: fakeStudent(), attemptId: 'a' });
    expect(r.level).toBe(2);
    expect(r.nextLevel).toBe(2);
    expect(r.leveledUp).toBe(false);
    expect(applyFinish).not.toHaveBeenCalled();
    expect(recordResults).not.toHaveBeenCalled();
    expect(prisma.attempt.update).not.toHaveBeenCalled();
  });
});
