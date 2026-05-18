import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Student } from '@prisma/client';
import { StudentService } from './student.service';

export interface StudentTokenRequest extends Request {
  /** Populated by the guard on success. */
  student?: Student;
}

/**
 * Resolves `:shareToken` from the route params (no session cookie, no CSRF —
 * the token in the URL IS the authorization). Returns 404 (NOT 401, NOT 403)
 * for any of: missing param, unknown token, soft-deleted student. We use 404
 * uniformly to avoid leaking which tokens have ever existed.
 */
@Injectable()
export class StudentTokenGuard implements CanActivate {
  constructor(private readonly students: StudentService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<StudentTokenRequest>();
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const token = params['shareToken'];
    if (!token) throw new NotFoundException();

    const student = await this.students.findByShareToken(token);
    if (!student) throw new NotFoundException();

    req.student = student;
    return true;
  }
}
