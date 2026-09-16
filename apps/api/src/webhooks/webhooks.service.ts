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
    const eventType = this.string(body.event) ?? this.string(body.eventType);
    const itemId = this.string(body.itemId) ?? this.nestedString(body.item, 'id');
    const clientUserId =
      this.string(body.clientUserId) ?? this.nestedString(body.item, 'clientUserId');
    const resourceId =
      this.string(body.transactionId) ?? this.string(body.accountId) ?? this.string(body.billId);
    if (!eventId || !eventType)
      throw new BadRequestException('Webhook eventId and event are required');

    const connection = await this.findOrCreateConnection(itemId, clientUserId);
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    let event;
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          provider: DataProvider.PLUGGY,
          eventId,
          eventType,
          itemId,
          clientUserId,
          resourceId,
          payloadHash,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.metrics.increment('webhook_duplicate_total');
        return { accepted: true, duplicate: true, eventId };
      }
      throw error;
    }

    if (!connection) {
      this.metrics.increment('webhook_failed_total');
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: WebhookEventStatus.FAILED, lastError: 'CONNECTION_NOT_FOUND' },
      });
      this.logger.warn(
        `webhook ignored event=${eventId} type=${eventType} reason=connection_not_found`,
      );
      return { accepted: true, eventId, queued: false };
    }

    await this.queue.enqueue(connection.id, {
      triggerEventId: eventId,
      triggerEventType: eventType,
      resourceId: resourceId ?? undefined,
    });
    this.logger.log(
      `webhook accepted event=${eventId} type=${eventType} connection=${connection.id}`,
    );
    return { accepted: true, eventId, queued: true };
  }

  private async findOrCreateConnection(itemId: string | null, clientUserId: string | null) {
    if (itemId) {
      const existing = await this.prisma.connection.findUnique({
        where: {
          provider_providerItemId: { provider: DataProvider.PLUGGY, providerItemId: itemId },
        },
      });
      if (existing) return existing;
    }
    if (!itemId || !clientUserId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: clientUserId },
      select: { id: true },
    });
    if (!user) return null;
    try {
      return await this.prisma.connection.create({
        data: {
          userId: user.id,
          provider: DataProvider.PLUGGY,
          providerItemId: itemId,
          status: 'PENDING',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.connection.findUnique({
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
}
