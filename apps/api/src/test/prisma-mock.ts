import { vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Returns a Prisma mock whose `magicLink`, `session`, `tutor`, `auditLog` etc.
 * surfaces are pre-stubbed with `vi.fn()`. Tests override specific methods
 * via `mock.<model>.<method>.mockResolvedValue(...)`.
 */
export function makePrismaMock(): PrismaService {
  const stub = () => vi.fn();
  return {
    magicLink: {
      create: stub(),
      findUnique: stub(),
      update: stub(),
      count: stub(),
      delete: stub(),
    },
    session: {
      create: stub(),
      findUnique: stub(),
      delete: stub(),
      deleteMany: stub(),
    },
    tutor: {
      create: stub(),
      findUnique: stub(),
      upsert: stub(),
      update: stub(),
    },
    auditLog: {
      create: stub(),
    },
    student: {
      create: stub(),
      findFirst: stub(),
      findUnique: stub(),
      findMany: stub(),
      update: stub(),
      delete: stub(),
      deleteMany: stub(),
      count: stub(),
    },
    lesson: {
      create: stub(),
      findFirst: stub(),
      findUnique: stub(),
      findMany: stub(),
      update: stub(),
      delete: stub(),
      deleteMany: stub(),
      count: stub(),
    },
    oAuthState: {
      create: stub(),
      findUnique: stub(),
      update: stub(),
      delete: stub(),
      deleteMany: stub(),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
}
