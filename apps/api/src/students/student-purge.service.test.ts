import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import { StudentPurgeService } from './student-purge.service';
import type { StudentService } from './student.service';

describe('StudentPurgeService.purgeExpired', () => {
  beforeEach(() => vi.clearAllMocks());

  it('audits when at least one student is purged', async () => {
    const students = {
      hardDeleteExpired: vi.fn().mockResolvedValue(2),
    } as unknown as StudentService;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new StudentPurgeService(students, audit);

    await service.purgeExpired();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'system.student.purged', metadata: { count: 2 } }),
    );
  });

  it('skips audit when zero rows deleted (avoid noise)', async () => {
    const students = {
      hardDeleteExpired: vi.fn().mockResolvedValue(0),
    } as unknown as StudentService;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new StudentPurgeService(students, audit);

    await service.purgeExpired();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('swallows errors so cron keeps running', async () => {
    const students = {
      hardDeleteExpired: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as StudentService;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new StudentPurgeService(students, audit);

    await expect(service.purgeExpired()).resolves.toBeUndefined();
  });
});
