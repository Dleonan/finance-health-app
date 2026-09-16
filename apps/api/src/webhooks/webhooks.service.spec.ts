import { Prisma } from '@prisma/client';
import { MetricsService } from '../observability/metrics.service';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  it('returns idempotently when the provider event already exists', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma = {
      connection: { findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }) },
      user: { findUnique: jest.fn() },
      webhookEvent: { create: jest.fn().mockRejectedValue(duplicate) },
    } as never;
    const queue = { enqueue: jest.fn() };
    const service = new WebhooksService(prisma, queue as never, new MetricsService());
    const result = await service.handle({
      eventId: 'evt-1',
      event: 'item/updated',
      itemId: 'item-1',
    });
    expect(result).toEqual({ accepted: true, duplicate: true, eventId: 'evt-1' });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('processes ten deliveries of the same event once', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    let creates = 0;
    const prisma = {
      connection: { findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }) },
      user: { findUnique: jest.fn() },
      webhookEvent: {
        create: jest.fn().mockImplementation(async () => {
          creates += 1;
          if (creates === 1) return { id: 'event-1' };
          throw duplicate;
        }),
      },
    } as never;
    const queue = { enqueue: jest.fn().mockResolvedValue({ id: 'run-1' }) };
    const service = new WebhooksService(prisma, queue as never, new MetricsService());
    const deliveries = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.handle({ eventId: 'evt-10x', event: 'item/updated', itemId: 'item-1' }),
      ),
    );
    expect(deliveries.filter((delivery) => 'queued' in delivery && delivery.queued)).toHaveLength(
      1,
    );
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects a webhook without an event id', async () => {
    const service = new WebhooksService({} as never, {} as never, new MetricsService());
    await expect(service.handle({ event: 'item/updated' })).rejects.toThrow(
      'eventId and event are required',
    );
  });
});
