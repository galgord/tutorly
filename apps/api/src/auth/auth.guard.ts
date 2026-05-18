import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE_NAME } from './cookie';
import { SessionService } from './session.service';

export interface AuthedRequest extends Request {
  tutor?: { id: string; email: string; name: string | null; locale: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException();

    const session = await this.sessions.resolve(token);
    if (!session) throw new UnauthorizedException();

    const tutor = await this.prisma.tutor.findUnique({
      where: { id: session.tutorId },
      select: { id: true, email: true, name: true, locale: true, deletedAt: true },
    });
    if (!tutor || tutor.deletedAt) throw new UnauthorizedException();

    req.tutor = { id: tutor.id, email: tutor.email, name: tutor.name, locale: tutor.locale };
    return true;
  }
}
