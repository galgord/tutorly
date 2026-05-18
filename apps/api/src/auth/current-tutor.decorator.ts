import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthedRequest } from './auth.guard';

export interface CurrentTutorPayload {
  id: string;
  email: string;
  name: string | null;
  locale: string;
}

export const CurrentTutor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentTutorPayload => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.tutor) {
      throw new Error('CurrentTutor used on a route without AuthGuard.');
    }
    return req.tutor;
  },
);
