import { GameType } from '@prisma/client';
import { type GameQuestion } from '@tutor-app/shared';
import { describe, expect, it } from 'vitest';
import { freshenRecycled } from './procedural-variation';
import { seededRng } from './question-sampler';

function tq(id: string, answer: string, tags: string[], distractors: string[]): GameQuestion {
  return {
    id,
    prompt: `${id}?`,
    answer,
    distractors,
    acceptAlternates: [],
    topicTags: tags,
    difficulty: 3,
  };
}

describe('freshenRecycled', () => {
  it('leaves FILL_BLANK questions untouched', () => {
    const q: GameQuestion = {
      id: 'q1',
      prompt: 'a ___',
      answer: 'x',
      distractors: [],
      acceptAlternates: [],
      topicTags: ['t'],
      difficulty: 2,
    };
    const out = freshenRecycled({
      questions: [q],
      bucketByQuestion: { q1: 'recycle' },
      pool: [q],
      gameType: GameType.FILL_BLANK,
      rng: seededRng(1),
    });
    expect(out[0]).toEqual(q);
  });

  it('leaves non-recycle TIMED_QUIZ questions untouched', () => {
    const pool = [
      tq('q1', 'Paris', ['geo'], ['Lyon', 'Nice', 'Brest']),
      tq('q2', 'Madrid', ['geo'], ['x', 'y', 'z']),
      tq('q3', 'Rome', ['geo'], ['a', 'b', 'c']),
      tq('q4', 'Berlin', ['geo'], ['d', 'e', 'f']),
    ];
    const out = freshenRecycled({
      questions: [pool[0]!],
      bucketByQuestion: { q1: 'new' },
      pool,
      gameType: GameType.TIMED_QUIZ,
      rng: seededRng(1),
    });
    expect(out[0]!.distractors).toEqual(['Lyon', 'Nice', 'Brest']);
  });

  it('swaps recycled TIMED_QUIZ distractors for same-topic sibling answers', () => {
    const pool = [
      tq('q1', 'Paris', ['geo'], ['Lyon', 'Nice', 'Brest']),
      tq('q2', 'Madrid', ['geo'], []),
      tq('q3', 'Rome', ['geo'], []),
      tq('q4', 'Berlin', ['geo'], []),
    ];
    const out = freshenRecycled({
      questions: [pool[0]!],
      bucketByQuestion: { q1: 'recycle' },
      pool,
      gameType: GameType.TIMED_QUIZ,
      rng: seededRng(3),
    });
    const swapped = out[0]!.distractors;
    expect(swapped).toHaveLength(3);
    // Distractors are now sibling answers, never the correct answer.
    expect(swapped).not.toContain('Paris');
    expect(new Set(swapped).size).toBe(3);
    expect(swapped.every((d) => ['Madrid', 'Rome', 'Berlin'].includes(d))).toBe(true);
  });

  it('keeps original distractors when there are too few same-topic siblings', () => {
    const pool = [
      tq('q1', 'Paris', ['geo'], ['Lyon', 'Nice', 'Brest']),
      tq('q2', 'gato', ['animals'], []), // different topic — not a candidate
    ];
    const out = freshenRecycled({
      questions: [pool[0]!],
      bucketByQuestion: { q1: 'recycle' },
      pool,
      gameType: GameType.TIMED_QUIZ,
      rng: seededRng(1),
    });
    expect(out[0]!.distractors).toEqual(['Lyon', 'Nice', 'Brest']);
  });

  it('preserves the base id and answer (seen-tracking + SR stay coherent)', () => {
    const pool = [
      tq('q1', 'Paris', ['geo'], ['Lyon', 'Nice', 'Brest']),
      tq('q2', 'Madrid', ['geo'], []),
      tq('q3', 'Rome', ['geo'], []),
      tq('q4', 'Berlin', ['geo'], []),
    ];
    const out = freshenRecycled({
      questions: [pool[0]!],
      bucketByQuestion: { q1: 'recycle' },
      pool,
      gameType: GameType.TIMED_QUIZ,
      rng: seededRng(5),
    });
    expect(out[0]!.id).toBe('q1');
    expect(out[0]!.answer).toBe('Paris');
  });
});
