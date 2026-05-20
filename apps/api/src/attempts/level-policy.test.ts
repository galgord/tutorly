import { describe, expect, it } from 'vitest';
import {
  computeLevelOutcome,
  MAX_LEVEL,
  MIN_LEVEL,
  type LevelPolicyConfig,
} from './level-policy';

const cfg = (over: Partial<LevelPolicyConfig> = {}): LevelPolicyConfig => ({
  advanceThreshold: 0.8,
  holdFloor: 0.5,
  nudgeEveryN: 3,
  minSample: 3,
  allowDown: false,
  ...over,
});

describe('computeLevelOutcome', () => {
  it('holds and leaves the nudge counter untouched when the sample is too small', () => {
    const out = computeLevelOutcome({
      state: { level: 3, nudgeCounter: 2 },
      correctNonReview: 2,
      answeredNonReview: 2, // < minSample (3)
      config: cfg(),
    });
    expect(out).toEqual({ level: 3, nudgeCounter: 2, delta: 0 });
  });

  it('advances one level on high accuracy and resets the nudge counter', () => {
    const out = computeLevelOutcome({
      state: { level: 2, nudgeCounter: 2 },
      correctNonReview: 9,
      answeredNonReview: 10, // 0.9 ≥ 0.8
      config: cfg(),
    });
    expect(out).toEqual({ level: 3, nudgeCounter: 0, delta: 1 });
  });

  it('a competent hold ticks the nudge counter but does not advance yet', () => {
    const out = computeLevelOutcome({
      state: { level: 2, nudgeCounter: 0 },
      correctNonReview: 6,
      answeredNonReview: 10, // 0.6 in [0.5, 0.8)
      config: cfg(),
    });
    expect(out).toEqual({ level: 2, nudgeCounter: 1, delta: 0 });
  });

  it('anti-stall nudge advances after N consecutive competent holds', () => {
    const out = computeLevelOutcome({
      state: { level: 2, nudgeCounter: 2 }, // this is the 3rd hold
      correctNonReview: 6,
      answeredNonReview: 10,
      config: cfg({ nudgeEveryN: 3 }),
    });
    expect(out).toEqual({ level: 3, nudgeCounter: 0, delta: 1 });
  });

  it('a struggling play never advances and resets the nudge counter', () => {
    const out = computeLevelOutcome({
      state: { level: 3, nudgeCounter: 2 },
      correctNonReview: 3,
      answeredNonReview: 10, // 0.3 < 0.5
      config: cfg(),
    });
    expect(out).toEqual({ level: 3, nudgeCounter: 0, delta: 0 });
  });

  it('steps down on a struggling play only when allowDown is enabled', () => {
    const out = computeLevelOutcome({
      state: { level: 3, nudgeCounter: 0 },
      correctNonReview: 1,
      answeredNonReview: 10,
      config: cfg({ allowDown: true }),
    });
    expect(out).toEqual({ level: 2, nudgeCounter: 0, delta: -1 });
  });

  it('clamps at the max level (advance at 5 is a no-op)', () => {
    const out = computeLevelOutcome({
      state: { level: MAX_LEVEL, nudgeCounter: 0 },
      correctNonReview: 10,
      answeredNonReview: 10,
      config: cfg(),
    });
    expect(out.level).toBe(MAX_LEVEL);
    expect(out.delta).toBe(0);
  });

  it('clamps at the min level (step-down at 1 is a no-op)', () => {
    const out = computeLevelOutcome({
      state: { level: MIN_LEVEL, nudgeCounter: 0 },
      correctNonReview: 0,
      answeredNonReview: 10,
      config: cfg({ allowDown: true }),
    });
    expect(out.level).toBe(MIN_LEVEL);
    expect(out.delta).toBe(0);
  });

  it('property: a sub-floor play NEVER advances, whatever the nudge counter', () => {
    for (let nudge = 0; nudge < 10; nudge++) {
      for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
        const out = computeLevelOutcome({
          state: { level, nudgeCounter: nudge },
          correctNonReview: 1,
          answeredNonReview: 10, // 0.1, below floor
          config: cfg({ nudgeEveryN: 2 }),
        });
        expect(out.delta).toBeLessThanOrEqual(0);
        expect(out.nudgeCounter).toBe(0); // struggling resets accrual
      }
    }
  });

  it('property: level outcome always stays within [1,5]', () => {
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
      for (const acc of [0, 0.3, 0.5, 0.7, 0.8, 1]) {
        const out = computeLevelOutcome({
          state: { level, nudgeCounter: 5 },
          correctNonReview: Math.round(acc * 10),
          answeredNonReview: 10,
          config: cfg({ allowDown: true }),
        });
        expect(out.level).toBeGreaterThanOrEqual(MIN_LEVEL);
        expect(out.level).toBeLessThanOrEqual(MAX_LEVEL);
      }
    }
  });
});
