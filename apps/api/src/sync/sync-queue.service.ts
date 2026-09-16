import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncRunStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type SyncTrigger = {
  triggerEventId?: string;
  triggerEventType?: string;
  resourceId?: string;
};

@Injectable()
export class SyncQueueService {
  private readonly logger = new Logger(SyncQueueService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(connectionId: string, trigger: SyncTrigger = {}) {
    const existing = await this.prisma.syncRun.findFirst({
      where: { connectionId, status: { in: [SyncRunStatus.QUEUED, SyncRunStatus.RUNNING] } },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;

    try {
      const run = await this.prisma.syncRun.create({
        data: {
          connectionId,
          status: SyncRunStatus.QUEUED,
          triggerEventId: trigger.triggerEventId,
          triggerEventType: trigger.triggerEventType,
          resourceId: trigger.resourceId,
        },
      });
      this.logger.debug(`sync queued run=${run.id} connection=${connectionId}`);
      return run;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.syncRun.findFirstOrThrow({
          where: { connectionId, status: { in: [SyncRunStatus.QUEUED, SyncRunStatus.RUNNING] } },
          orderBy: { createdAt: 'asc' },
        });
      }
      throw error;
    }
  }

  async claimNext() {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT sr."id"
        FROM "SyncRun" sr
        INNER JOIN "Connection" c ON c."id" = sr."connectionId"
        WHERE sr."status" = 'QUEUED'
          AND c."status" NOT IN ('SYNCING', 'DISCONNECTED')
        ORDER BY sr."createdAt" ASC
        FOR UPDATE OF sr, c SKIP LOCKED
        LIMIT 1
      `);
      const candidate = candidates[0];
      if (!candidate) return null;

      const now = new Date();
      const run = await tx.syncRun.update({
        where: { id: candidate.id },
        data: { status: SyncRunStatus.RUNNING, startedAt: now },
        include: { connection: true },
      });
      await tx.connection.update({
        where: { id: run.connectionId },
        data: { status: 'SYNCING', lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
      });
      return run;
    });
  }
}
