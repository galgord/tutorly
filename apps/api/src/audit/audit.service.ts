import { Injectable, Logger } from '@nestjs/common';
import { ActorType, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  tutorId?: string | null;
  actorType: ActorType;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tutorId: input.tutorId ?? null,
          actorType: input.actorType,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      // Audit writes must never break the request path.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`audit log write failed (${input.action}): ${message}`);
    }
  }
}
