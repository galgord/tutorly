import { describe, expect, it } from 'vitest';
import { DEFAULT_SR_INTERVALS_DAYS, MAX_BOX, MIN_BOX, dueDate, nextReview } from './leitner';

const intervals = DEFAULT_SR_INTERVALS_DAYS; // [0,1,3,7,16]

describe('nextReview', () => {
  it('promotes one box on a correct answer', () => {
    expect(nextReview({ box: 1, correct: true, intervals }).box).toBe(2);
    expect(nextReview({ box: 3, correct: true, intervals }).box).toBe(4);
  });

  it('resets to box 1 on a wrong answer', () => {
    expect(nextReview({ box: 4, correct: false, intervals }).box).toBe(MIN_BOX);
    expect(nextReview({ box: 1, correct: false, intervals }).box).toBe(MIN_BOX);
  });

  it('clamps promotion at the max box', () => {
    expect(nextReview({ box: MAX_BOX, correct: true, intervals }).box).toBe(MAX_BOX);
  });

  it('returns the interval for the resulting box (1-indexed)', () => {
    expect(nextReview({ box: 1, correct: true, intervals }).intervalDays).toBe(intervals[1]); // box 2 → 1 day
    expect(nextReview({ box: 4, correct: true, intervals }).intervalDays).toBe(intervals[4]); // box 5 → 16 days
    expect(nextReview({ box: 3, correct: false, intervals }).intervalDays).toBe(intervals[0]); // box 1 → 0 days
  });

  it('treats a new question (box 1) as: correct → box 2, wrong → box 1 (due now)', () => {
    expect(nextReview({ box: 1, correct: true, intervals })).toEqual({ box: 2, intervalDays: 1 });
    expect(nextReview({ box: 1, correct: false, intervals })).toEqual({ box: 1, intervalDays: 0 });
  });

  it('clamps the interval index when the intervals array is shorter than the box', () => {
    const short = [0, 1]; // only two entries
    const out = nextReview({ box: 5, correct: true, intervals: short });
    expect(out.box).toBe(MAX_BOX);
    expect(out.intervalDays).toBe(1); // clamped to last entry
  });

  it('falls back to the default intervals when given an empty array', () => {
    expect(nextReview({ box: 1, correct: true, intervals: [] }).intervalDays).toBe(
      DEFAULT_SR_INTERVALS_DAYS[1],
    );
  });
});

describe('dueDate', () => {
  it('adds the interval in days to now', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    expect(dueDate(now, 3).toISOString()).toBe('2026-05-23T00:00:00.000Z');
    expect(dueDate(now, 0).getTime()).toBe(now.getTime());
  });
});
