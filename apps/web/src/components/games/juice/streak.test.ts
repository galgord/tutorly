import { describe, expect, it } from 'vitest';
import { initialStreak, streakReduce, streakTier, type StreakState } from './streak';

function run(events: Parameters<typeof streakReduce>[1][]): StreakState {
  return events.reduce(streakReduce, initialStreak);
}

describe('streakReduce', () => {
  it('increments current and tracks the session best on correct', () => {
    const s = run(['correct', 'correct']);
    expect(s.current).toBe(2);
    expect(s.best).toBe(2);
  });

  it('resets current on wrong/timeout but keeps the best', () => {
    let s = run(['correct', 'correct', 'correct', 'correct']); // current 4
    s = streakReduce(s, 'wrong');
    expect(s.current).toBe(0);
    expect(s.best).toBe(4);
    s = streakReduce(streakReduce(s, 'correct'), 'timeout');
    expect(s.current).toBe(0);
    expect(s.best).toBe(4);
  });

  it('fires justMilestone exactly when crossing tiers 3 / 5 / 10', () => {
    let s = initialStreak;
    const fired: (number | null)[] = [];
    for (let i = 0; i < 11; i++) {
      s = streakReduce(s, 'correct');
      fired.push(s.justMilestone);
    }
    expect(fired).toEqual([null, null, 3, null, 5, null, null, null, null, 10, null]);
  });

  it('re-fires a milestone after a reset only when the tier is re-crossed', () => {
    let s = run(['correct', 'correct', 'correct']);
    expect(s.justMilestone).toBe(3);
    s = streakReduce(s, 'wrong');
    expect(s.justMilestone).toBeNull();
    s = streakReduce(s, 'correct'); // 1
    s = streakReduce(s, 'correct'); // 2
    expect(s.justMilestone).toBeNull();
    s = streakReduce(s, 'correct'); // 3 → tier crossed again
    expect(s.justMilestone).toBe(3);
  });

  it('reset returns to the initial state', () => {
    expect(streakReduce(run(['correct', 'correct']), 'reset')).toEqual(initialStreak);
  });

  it('streakTier maps counts to cosmetic tiers', () => {
    expect([0, 2, 3, 4, 5, 9, 10, 99].map(streakTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});
