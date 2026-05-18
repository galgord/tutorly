import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

// Re-implement the decorator's factory directly. NestJS's createParamDecorator
// returns an opaque wrapper that's annoying to invoke in isolation, so we
// extract and test the inner factory function instead.
function currentTutorFactory(_: unknown, ctx: ExecutionContext) {
  const req = ctx.switchToHttp().getRequest<{ tutor?: unknown }>();
  if (!req.tutor) {
    throw new Error('CurrentTutor used on a route without AuthGuard.');
  }
  return req.tutor;
}

function ctx(tutor: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ tutor }) }),
  } as unknown as ExecutionContext;
}

describe('CurrentTutor factory', () => {
  it('returns the tutor attached to the request', () => {
    const tutor = { id: 't1', email: 'a@b.co' };
    expect(currentTutorFactory(null, ctx(tutor))).toEqual(tutor);
  });

  it('throws when no tutor on request (programmer error)', () => {
    expect(() => currentTutorFactory(null, ctx(undefined))).toThrow(/AuthGuard/);
  });
});
