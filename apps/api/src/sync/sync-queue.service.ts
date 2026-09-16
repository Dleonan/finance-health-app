import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncRunStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type SyncTrigger = {
  triggerEventId?: string;
  triggerEventType?: string;
  resourceId?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
};

type QueueDb = Pick<PrismaService, 'syncRun' | 'webhookEvent'>;

@Injectable()
export class SyncQueueService {
  private readonly logger = new Logger(SyncQueueService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(connectionId: string, trigger: SyncTrigger = {}, db: QueueDb = this.prisma) {
    const existing = await db.syncRun.findFirst({
      where: { connectionId, status: SyncRunStatus.QUEUED },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      await this.linkWebhookEvent(db, existing.id, connectionId, trigger.triggerEventId);
      return existing;
    }

    try {
      const run = await db.syncRun.create({
        data: {
          connectionId,
          status: SyncRunStatus.QUEUED,
          triggerEventId: trigger.triggerEventId,
          triggerEventType: trigger.triggerEventType,
          resourceId: trigger.resourceId,
          errorCode: trigger.providerErrorCode,
          errorMessage: trigger.providerErrorMessage,
        },
      });
      await this.linkWebhookEvent(db, run.id, connectionId, trigger.triggerEventId);
      this.logger.debug(`sync queued run=${run.id} connection=${connectionId}`);
      return run;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const run = await db.syncRun.findFirstOrThrow({
          where: { connectionId, status: SyncRunStatus.QUEUED },
          orderBy: { createdAt: 'asc' },
        });
        await this.linkWebhookEvent(db, run.id, connectionId, trigger.triggerEventId);
        return run;
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
          AND (sr."nextAttemptAt" IS NULL OR sr."nextAttemptAt" <= NOW())
          AND c."status" NOT IN ('SYNCING', 'DISCONNECTED', 'REAUTH_REQUIRED')
        ORDER BY sr."createdAt" ASC
        FOR UPDATE OF sr, c SKIP LOCKED
        LIMIT 1
      `);
      const candidate = candidates[0];
      if (!candidate) return null;

      const now = new Date();
      const run = await tx.syncRun.update({
        where: { id: candidate.id },
        data: {
          status: SyncRunStatus.RUNNING,
          startedAt: now,
          nextAttemptAt: null,
          attempts: { increment: 1 },
        },
        include: { connection: true, webhookEvents: true },
      });
      await tx.connection.update({
        where: { id: run.connectionId },
        data: { status: 'SYNCING', lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
      });
      return run;
    });
  }

  private async linkWebhookEvent(
    db: QueueDb,
    syncRunId: string,
    connectionId: string,
    triggerEventId?: string,
  ) {
    if (!triggerEventId) return;
    await db.webhookEvent.updateMany({
      where: { provider: 'PLUGGY', eventId: triggerEventId },
      data: { connectionId, syncRunId },
    });
  }
}
