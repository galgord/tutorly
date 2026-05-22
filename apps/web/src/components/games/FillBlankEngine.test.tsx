import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartAttemptResponse } from '@tutor-app/shared';

vi.mock('../../lib/attempt-buffer', () => ({ submitBufferedAnswer: vi.fn() }));
import { submitBufferedAnswer } from '../../lib/attempt-buffer';
import { FillBlankEngine } from './FillBlankEngine';

function makeAttempt(): StartAttemptResponse {
  const q = (id: string) => ({
    id,
    prompt: `${id} ___`,
    promptTranslation: null,
    choices: [] as string[],
    topicTags: [] as string[],
    difficulty: 3,
    isReview: false,
  });
  return {
    attemptId: 'a1',
    gameId: 'g1',
    locale: 'en',
    type: 'FILL_BLANK',
    questions: [q('q1'), q('q2'), q('q3')],
    livesAllowed: 0,
    perQuestionSeconds: 0,
    level: 1,
    levelMax: 5,
  };
}

function resolveOnce(correct: boolean, scoreSoFar: number): void {
  vi.mocked(submitBufferedAnswer).mockResolvedValueOnce({
    buffered: {},
    response: { correct, correctAnswer: 'right', scoreSoFar, gameOver: false },
  } as unknown as Awaited<ReturnType<typeof submitBufferedAnswer>>);
}

async function answer(text: string): Promise<void> {
  fireEvent.change(screen.getByTestId('play-answer-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('play-submit'));
  await waitFor(() => expect(screen.getByTestId('play-feedback')).toBeInTheDocument());
}

describe('FillBlankEngine — juice wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the SERVER verdict and shows the server score delta as +N', async () => {
    resolveOnce(true, 10);
    render(<FillBlankEngine shareToken="t" attempt={makeAttempt()} onFinished={vi.fn()} />);
    await answer('foo');
    expect(screen.getByTestId('play-feedback')).toHaveAttribute('data-correct', 'true');
    expect(screen.getByTestId('play-score-pop')).toHaveTextContent('+10');
  });

  it('shows the streak meter once two in a row are correct', async () => {
    render(<FillBlankEngine shareToken="t" attempt={makeAttempt()} onFinished={vi.fn()} />);
    resolveOnce(true, 10);
    await answer('one');
    expect(screen.queryByTestId('play-streak')).toBeNull(); // streak 1 — hidden
    fireEvent.click(screen.getByTestId('play-next'));
    resolveOnce(true, 20);
    await answer('two');
    expect(screen.getByTestId('play-streak')).toHaveTextContent('2');
  });

  it('a wrong verdict shows no +N and breaks the streak', async () => {
    render(<FillBlankEngine shareToken="t" attempt={makeAttempt()} onFinished={vi.fn()} />);
    resolveOnce(true, 10);
    await answer('one'); // streak 1
    fireEvent.click(screen.getByTestId('play-next'));
    resolveOnce(false, 10);
    await answer('nope');
    expect(screen.getByTestId('play-feedback')).toHaveAttribute('data-correct', 'false');
    expect(screen.queryByTestId('play-score-pop')).toBeNull();
    expect(screen.queryByTestId('play-streak')).toBeNull(); // reset to 0 → hidden
  });
});
