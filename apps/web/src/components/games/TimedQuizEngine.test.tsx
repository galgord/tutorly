import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartAttemptResponse } from '@tutor-app/shared';

vi.mock('../../lib/attempt-buffer', () => ({ submitBufferedAnswer: vi.fn() }));
import { submitBufferedAnswer } from '../../lib/attempt-buffer';
import { TimedQuizEngine } from './TimedQuizEngine';

function makeAttempt(): StartAttemptResponse {
  const q = (id: string) => ({
    id,
    prompt: `${id}?`,
    promptTranslation: null,
    choices: ['A', 'B', 'C', 'D'],
    topicTags: [] as string[],
    difficulty: 3,
    isReview: false,
  });
  return {
    attemptId: 'a1',
    gameId: 'g1',
    locale: 'en',
    type: 'TIMED_QUIZ',
    questions: [q('q1'), q('q2'), q('q3')],
    livesAllowed: 3,
    perQuestionSeconds: 30,
    level: 2,
    levelMax: 5,
  };
}

function resolveOnce(p: {
  correct: boolean;
  correctAnswer: string;
  scoreSoFar: number;
  livesRemaining: number;
}): void {
  vi.mocked(submitBufferedAnswer).mockResolvedValueOnce({
    buffered: {},
    response: { ...p, gameOver: false },
  } as unknown as Awaited<ReturnType<typeof submitBufferedAnswer>>);
}

describe('TimedQuizEngine — Answer Blast bubbles + juice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves the play-choice / lives / timer testids', () => {
    render(<TimedQuizEngine shareToken="t" attempt={makeAttempt()} onFinished={vi.fn()} />);
    [0, 1, 2, 3].forEach((i) => expect(screen.getByTestId(`play-choice-${i}`)).toBeInTheDocument());
    expect(screen.getByTestId('play-timer')).toBeInTheDocument();
    expect(screen.getByTestId('play-lives')).toBeInTheDocument();
    [0, 1, 2].forEach((i) => expect(screen.getByTestId(`play-life-${i}`)).toBeInTheDocument());
  });

  it('a correct pick shows the server score delta as +N and pops that bubble', async () => {
    resolveOnce({ correct: true, correctAnswer: 'A', scoreSoFar: 100, livesRemaining: 3 });
    render(<TimedQuizEngine shareToken="t" attempt={makeAttempt()} onFinished={vi.fn()} />);
    fireEvent.click(screen.getByTestId('play-choice-0'));
    await waitFor(() => expect(screen.getByTestId('play-feedback')).toHaveAttribute('data-correct', 'true'));
    expect(screen.getByTestId('play-score-pop')).toHaveTextContent('+100');
    expect(screen.getByTestId('play-choice-0').className).toContain('animate-pop');
  });

  it('a wrong pick loses a life (heart-loss), wobbles, and shows no +N', async () => {
    resolveOnce({ correct: false, correctAnswer: 'A', scoreSoFar: 0, livesRemaining: 2 });
    render(<TimedQuizEngine shareToken="t" attempt={makeAttempt()} onFinished={vi.fn()} />);
    fireEvent.click(screen.getByTestId('play-choice-3'));
    await waitFor(() => expect(screen.getByTestId('play-feedback')).toHaveAttribute('data-correct', 'false'));
    expect(screen.queryByTestId('play-score-pop')).toBeNull();
    expect(screen.getByTestId('play-choice-3').className).toContain('animate-wobble');
    // The slot that just emptied (index === new livesRemaining) animates out.
    expect(screen.getByTestId('play-life-2').className).toContain('animate-heart-loss');
  });
});
