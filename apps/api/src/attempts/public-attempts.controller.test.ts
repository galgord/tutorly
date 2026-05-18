import { BadRequestException } from '@nestjs/common';
import { GameType, type Attempt, type Student } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { AttemptService } from './attempt.service';
import { PublicAttemptsController } from './public-attempts.controller';

function fakeStudent(over: Partial<Student> = {}): Student {
  return {
    id: 'stu_1',
    tutorId: 't',
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

function fakeReq(student: Student = fakeStudent()) {
  return { student, header: () => null } as unknown as Parameters<
    PublicAttemptsController['start']
  >[1];
}

function fakeAttempt(over: Partial<Attempt> = {}): Attempt {
  return {
    id: 'att_1',
    gameId: 'game_1',
    studentId: 'stu_1',
    score: 0,
    livesLost: 0,
    startedAt: new Date('2026-05-18T10:00:00Z'),
    finishedAt: null,
    questionResults: [] as never,
    createdAt: new Date(),
    ...over,
  } as Attempt;
}

describe('PublicAttemptsController.start', () => {
  let attempts: { startAttempt: ReturnType<typeof vi.fn>; freezeChoices: ReturnType<typeof vi.fn>; publicChoicesForAttempt: ReturnType<typeof vi.fn> } & AttemptService;
  let audit: { record: ReturnType<typeof vi.fn> } & AuditService;
  let controller: PublicAttemptsController;

  beforeEach(() => {
    attempts = {
      startAttempt: vi.fn(),
      freezeChoices: vi.fn(),
      publicChoicesForAttempt: vi.fn(),
    } as unknown as typeof attempts;
    audit = { record: vi.fn() } as unknown as typeof audit;
    controller = new PublicAttemptsController(attempts, audit);
  });

  it('FILL_BLANK start: no choices in response', async () => {
    attempts.startAttempt.mockResolvedValue({
      attempt: fakeAttempt(),
      type: GameType.FILL_BLANK,
      locale: 'en',
      questions: [
        { id: 'q1', prompt: 'She ___ to school.', answer: 'walks', distractors: [], acceptAlternates: [], topicTags: [] },
      ],
      livesAllowed: 0,
      perQuestionSeconds: 0,
    });
    const out = await controller.start('game_1', fakeReq());
    expect(out.questions[0]?.choices).toEqual([]);
    expect(out.livesAllowed).toBe(0);
    // Never freezes choices for FILL_BLANK.
    expect(attempts.freezeChoices).not.toHaveBeenCalled();
  });

  it('TIMED_QUIZ start: freezes + ships server-frozen choices', async () => {
    attempts.startAttempt.mockResolvedValue({
      attempt: fakeAttempt({ id: 'att_q' }),
      type: GameType.TIMED_QUIZ,
      locale: 'en',
      questions: [
        { id: 'q1', prompt: 'Capital?', answer: 'Paris', distractors: ['Lyon'], acceptAlternates: [], topicTags: [] },
      ],
      livesAllowed: 3,
      perQuestionSeconds: 20,
    });
    attempts.publicChoicesForAttempt.mockResolvedValue({ q1: ['Lyon', 'Paris'] });
    const out = await controller.start('game_1', fakeReq());
    expect(attempts.freezeChoices).toHaveBeenCalledWith('att_q');
    expect(out.questions[0]?.choices).toEqual(['Lyon', 'Paris']);
  });

  it('Never leaks the answer field into the response', async () => {
    attempts.startAttempt.mockResolvedValue({
      attempt: fakeAttempt(),
      type: GameType.FILL_BLANK,
      locale: 'en',
      questions: [
        { id: 'q1', prompt: 'p', answer: 'SECRET', distractors: [], acceptAlternates: ['s'], topicTags: [] },
      ],
      livesAllowed: 0,
      perQuestionSeconds: 0,
    });
    const out = await controller.start('game_1', fakeReq());
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('acceptAlternates');
  });
});

describe('PublicAttemptsController.submit', () => {
  let attempts: { submitAnswer: ReturnType<typeof vi.fn> } & AttemptService;
  let audit: { record: ReturnType<typeof vi.fn> } & AuditService;
  let controller: PublicAttemptsController;

  beforeEach(() => {
    attempts = { submitAnswer: vi.fn() } as unknown as typeof attempts;
    audit = { record: vi.fn() } as unknown as typeof audit;
    controller = new PublicAttemptsController(attempts, audit);
  });

  it('400s on malformed body', async () => {
    await expect(controller.submit('a', { foo: 'bar' }, fakeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the scorer response shape', async () => {
    attempts.submitAnswer.mockResolvedValue({
      record: {
        questionId: 'q1',
        prompt: 'p',
        correct: true,
        rawAnswer: 'walks',
        normalizedAnswer: 'walks',
        expectedAnswer: 'walks',
        answeredAt: new Date().toISOString(),
        topicTags: [],
      },
      scoreSoFar: 1,
      gameOver: false,
    });
    const out = await controller.submit(
      'a',
      { questionId: 'q1', rawAnswer: 'walks' },
      fakeReq(),
    );
    expect(out).toMatchObject({ correct: true, correctAnswer: 'walks', scoreSoFar: 1 });
  });

  it('audit metadata does NOT include raw answer text (PII boundary)', async () => {
    attempts.submitAnswer.mockResolvedValue({
      record: {
        questionId: 'q1',
        prompt: 'p',
        correct: false,
        rawAnswer: 'super-secret-typo',
        normalizedAnswer: 'super-secret-typo',
        expectedAnswer: 'walks',
        answeredAt: new Date().toISOString(),
        topicTags: [],
      },
      scoreSoFar: 0,
      gameOver: false,
    });
    await controller.submit('a', { questionId: 'q1', rawAnswer: 'super-secret-typo' }, fakeReq());
    const meta = (audit.record as ReturnType<typeof vi.fn>).mock.calls[0][0].metadata as Record<string, unknown>;
    expect(JSON.stringify(meta)).not.toContain('super-secret-typo');
  });
});

describe('PublicAttemptsController.finish', () => {
  let attempts: { finishAttempt: ReturnType<typeof vi.fn> } & AttemptService;
  let audit: { record: ReturnType<typeof vi.fn> } & AuditService;
  let controller: PublicAttemptsController;

  beforeEach(() => {
    attempts = { finishAttempt: vi.fn() } as unknown as typeof attempts;
    audit = { record: vi.fn() } as unknown as typeof audit;
    controller = new PublicAttemptsController(attempts, audit);
  });

  it('returns the summary', async () => {
    attempts.finishAttempt.mockResolvedValue({
      attempt: fakeAttempt({ score: 7, livesLost: 1, finishedAt: new Date('2026-05-18T10:30:00Z') }),
      bestEver: 8,
      totalQuestions: 10,
    });
    const out = await controller.finish('a', fakeReq());
    expect(out.score).toBe(7);
    expect(out.bestEver).toBe(8);
    expect(out.total).toBe(10);
    expect(out.finishedAt).toBe('2026-05-18T10:30:00.000Z');
  });
});
