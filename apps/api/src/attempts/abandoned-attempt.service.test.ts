import { ActorType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { AbandonedAttemptService } from './abandoned-attempt.service';
import type { AttemptService } from './attempt.service';

function makeAudit(): { record: ReturnType<typeof vi.fn> } & AuditService {
  return { record: vi.fn() } as unknown as { record: ReturnType<typeof vi.fn> } & AuditService;
}

describe('AbandonedAttemptService', () => {
  let attempts: { finishAbandoned: ReturnType<typeof vi.fn> } & AttemptService;
  let audit: { record: ReturnType<typeof vi.fn> } & AuditService;
  let service: AbandonedAttemptService;

  beforeEach(() => {
    attempts = {
      finishAbandoned: vi.fn(),
    } as unknown as { finishAbandoned: ReturnType<typeof vi.fn> } & AttemptService;
    audit = makeAudit();
    service = new AbandonedAttemptService(attempts, audit);
  });

  it('writes an audit when one or more attempts were swept', async () => {
    (attempts.finishAbandoned as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    await service.sweep();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: ActorType.SYSTEM,
        action: 'system.attempt.abandoned',
        metadata: { count: 3 },
      }),
    );
  });

  it('skips audit when no abandoned attempts were found', async () => {
    (attempts.finishAbandoned as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    await service.sweep();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('swallows + logs errors instead of throwing', async () => {
    (attempts.finishAbandoned as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    await expect(service.sweep()).resolves.toBeUndefined();
  });
});
