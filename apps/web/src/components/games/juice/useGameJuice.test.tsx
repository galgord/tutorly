import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sound', () => ({
  isSoundEnabled: vi.fn(() => true),
  setSoundEnabled: vi.fn(),
  unlockAudio: vi.fn(),
  playSound: vi.fn(),
}));
vi.mock('./haptics', () => ({ vibrate: vi.fn() }));
vi.mock('./confetti', () => ({ fireConfetti: vi.fn(() => Promise.resolve()) }));

import { fireConfetti } from './confetti';
import { isSoundEnabled, playSound } from './sound';
import { useGameJuice } from './useGameJuice';

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}

describe('useGameJuice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSoundEnabled).mockReturnValue(true);
    mockMatchMedia(false);
  });

  it('reacts to the SERVER verdict and never computes correctness itself', () => {
    const { result } = renderHook(() => useGameJuice());
    act(() => result.current.onAnswer({ correct: true }));
    expect(result.current.streak.current).toBe(1);
    act(() => result.current.onAnswer({ correct: true }));
    expect(result.current.streak.current).toBe(2);
    act(() => result.current.onAnswer({ correct: false }));
    expect(result.current.streak.current).toBe(0);
  });

  it('plays the matching cue for the passed verdict', () => {
    const { result } = renderHook(() => useGameJuice());
    act(() => result.current.onAnswer({ correct: true }));
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('correct');
    act(() => result.current.onAnswer({ correct: false }));
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('wrong');
  });

  it('plays NO sound when sound is muted (gated at call time)', () => {
    vi.mocked(isSoundEnabled).mockReturnValue(false);
    const { result } = renderHook(() => useGameJuice());
    act(() => result.current.onAnswer({ correct: true }));
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
  });

  it('fires a combo cue + confetti when a streak crosses a milestone', () => {
    const { result } = renderHook(() => useGameJuice());
    act(() => result.current.onAnswer({ correct: true }));
    act(() => result.current.onAnswer({ correct: true }));
    act(() => result.current.onAnswer({ correct: true })); // 3 → milestone
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('combo');
    expect(vi.mocked(fireConfetti)).toHaveBeenCalledWith('combo');
  });

  it('fires NO confetti at a milestone under prefers-reduced-motion', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useGameJuice());
    act(() => result.current.onAnswer({ correct: true }));
    act(() => result.current.onAnswer({ correct: true }));
    act(() => result.current.onAnswer({ correct: true })); // milestone, but calm
    expect(vi.mocked(fireConfetti)).not.toHaveBeenCalled();
  });
});
