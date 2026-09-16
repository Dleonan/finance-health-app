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
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
      connection: { findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }) },
      user: { findUnique: jest.fn() },
      webhookEvent: {
        create: jest.fn().mockRejectedValue(duplicate),
        findUnique: jest.fn().mockResolvedValue({
          id: 'event-1',
          status: 'PROCESSED',
          syncRunId: null,
        }),
      },
    } as never;
    const queue = { enqueue: jest.fn() };
    const service = new WebhooksService(prisma, queue as never, new MetricsService());
    const result = await service.handle({
      eventId: 'evt-1',
      event: 'item/updated',
      itemId: 'item-1',
    });
    expect(result).toEqual({
      accepted: true,
      duplicate: true,
      eventId: 'evt-1',
      queued: false,
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('processes ten deliveries of the same event once', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    let creates = 0;
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
      connection: { findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }) },
      user: { findUnique: jest.fn() },
      webhookEvent: {
        create: jest.fn().mockImplementation(async () => {
          creates += 1;
          if (creates === 1) return { id: 'event-1' };
          throw duplicate;
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'event-1',
          status: 'PROCESSED',
          syncRunId: 'run-1',
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

  it('persists transactionIds and repairs an event left without a queue link', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'event-1' })
      .mockRejectedValueOnce(duplicate);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: 'event-1', status: 'RECEIVED', syncRunId: null });
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
      connection: { findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }) },
      user: { findUnique: jest.fn() },
      webhookEvent: {
        create,
        findUnique,
        update: jest.fn(),
      },
    } as never;
    const queue = { enqueue: jest.fn().mockResolvedValue({ id: 'run-1' }) };
    const service = new WebhooksService(prisma, queue as never, new MetricsService());

    await service.handle({
      eventId: 'evt-transactions',
      event: 'transactions/updated',
      itemId: 'item-1',
      accountId: 'account-1',
      transactionIds: ['tx-1', 'tx-2', 'tx-1'],
    });
    const repaired = await service.handle({
      eventId: 'evt-orphan',
      event: 'transactions/deleted',
      itemId: 'item-1',
      transactionIds: ['tx-3', 'tx-4'],
    });

    expect(create.mock.calls[0][0].data).toMatchObject({
      providerAccountId: 'account-1',
      resourceId: 'tx-1',
      resourceIds: ['tx-1', 'tx-2'],
    });
    expect(repaired).toMatchObject({ accepted: true, duplicate: true, queued: true });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('captures the provider error code as a product-state input', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'event-error' });
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
      connection: { findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }) },
      user: { findUnique: jest.fn() },
      webhookEvent: { create },
    } as never;
    const service = new WebhooksService(
      prisma,
      { enqueue: jest.fn().mockResolvedValue({ id: 'run-1' }) } as never,
      new MetricsService(),
    );

    await service.handle({
      eventId: 'evt-error',
      event: 'item/error',
      itemId: 'item-1',
      error: { code: 'REAUTH_REQUIRED', message: 'reauth' },
    });

    expect(create.mock.calls[0][0].data.providerErrorCode).toBe('REAUTH_REQUIRED');
  });

  it('rejects a webhook without an event id', async () => {
    const service = new WebhooksService({} as never, {} as never, new MetricsService());
    await expect(service.handle({ event: 'item/updated' })).rejects.toThrow(
      'eventId and event are required',
    );
  });
});
