import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataProvider, Prisma, WebhookEventStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { SyncQueueService } from '../sync/sync-queue.service';
import { MetricsService } from '../observability/metrics.service';

type WebhookPayload = Record<string, unknown>;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SyncQueueService,
    private readonly metrics: MetricsService,
  ) {}

  async handle(payload: unknown) {
    this.metrics.increment('webhook_received_total');
    if (!payload || typeof payload !== 'object')
      throw new BadRequestException('Invalid webhook payload');
    const body = payload as WebhookPayload;
    const eventId = this.string(body.eventId) ?? this.string(body.id);
    const eventType = (this.string(body.event) ?? this.string(body.eventType))?.toLowerCase();
    const itemId = this.string(body.itemId) ?? this.nestedString(body.item, 'id');
    const clientUserId =
      this.string(body.clientUserId) ?? this.nestedString(body.item, 'clientUserId');
    const providerAccountId = this.string(body.accountId);
    const transactionIds = this.stringArray(body.transactionIds);
    const resourceId =
      transactionIds[0] ??
      this.string(body.transactionId) ??
      this.string(body.accountId) ??
      this.string(body.billId) ??
      (eventType === 'item/deleted' ? itemId : null);
    const providerErrorCode =
      this.nestedString(body.error, 'code') ?? this.string(body.errorCode);
    if (!eventId || !eventType)
      throw new BadRequestException('Webhook eventId and event are required');

    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const connection = await this.findOrCreateConnection(tx, itemId, clientUserId);
      let event;
      try {
        event = await tx.webhookEvent.create({
          data: {
            provider: DataProvider.PLUGGY,
            eventId,
            eventType,
            itemId,
            clientUserId,
            providerAccountId,
            resourceId,
            resourceIds: transactionIds.length ? transactionIds : undefined,
            providerErrorCode,
            connectionId: connection?.id,
            payloadHash,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
          throw error;

        this.metrics.increment('webhook_duplicate_total');
        const existing = await tx.webhookEvent.findUnique({
          where: { provider_eventId: { provider: DataProvider.PLUGGY, eventId } },
        });
        if (!existing) throw error;
        if (existing.status === WebhookEventStatus.PROCESSED || existing.syncRunId || !connection)
          return { accepted: true, duplicate: true, eventId, queued: false };

        await this.queue.enqueue(
          connection.id,
          {
            triggerEventId: eventId,
            triggerEventType: eventType,
            resourceId: resourceId ?? undefined,
            providerErrorCode: providerErrorCode ?? undefined,
          },
          tx,
        );
        return { accepted: true, duplicate: true, eventId, queued: true };
      }

      if (!connection) {
        this.metrics.increment('webhook_failed_total');
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: WebhookEventStatus.FAILED, lastError: 'CONNECTION_NOT_FOUND' },
        });
        this.logger.warn(
          `webhook ignored event=${eventId} type=${eventType} reason=connection_not_found`,
        );
        return { accepted: true, eventId, queued: false };
      }

      await this.queue.enqueue(
        connection.id,
        {
          triggerEventId: eventId,
          triggerEventType: eventType,
          resourceId: resourceId ?? undefined,
          providerErrorCode: providerErrorCode ?? undefined,
        },
        tx,
      );
      this.logger.log(
        `webhook accepted event=${eventId} type=${eventType} connection=${connection.id}`,
      );
      return { accepted: true, eventId, queued: true };
    });
  }

  private async findOrCreateConnection(
    db: Pick<PrismaService, 'connection' | 'user'>,
    itemId: string | null,
    clientUserId: string | null,
  ) {
    if (itemId) {
      const existing = await db.connection.findUnique({
        where: {
          provider_providerItemId: { provider: DataProvider.PLUGGY, providerItemId: itemId },
        },
      });
      if (existing) return existing;
    }
    if (!itemId || !clientUserId) return null;
    const user = await db.user.findUnique({
      where: { id: clientUserId },
      select: { id: true },
    });
    if (!user) return null;
    try {
      return await db.connection.create({
        data: {
          userId: user.id,
          provider: DataProvider.PLUGGY,
          providerItemId: itemId,
          status: 'PENDING',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return db.connection.findUnique({
          where: {
            provider_providerItemId: { provider: DataProvider.PLUGGY, providerItemId: itemId },
          },
        });
      }
      throw error;
    }
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private nestedString(value: unknown, key: string) {
    return value && typeof value === 'object' ? this.string((value as WebhookPayload)[key]) : null;
  }

  private stringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((entry) => this.string(entry)).filter((entry): entry is string => !!entry))];
  }
}
