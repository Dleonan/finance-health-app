import { Prisma } from '@prisma/client';
import { SyncQueueService } from './sync-queue.service';

describe('SyncQueueService coalescing', () => {
  it('never attaches a webhook to a RUNNING run', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'queued-1', status: 'QUEUED' });
    const updateMany = jest.fn();
    const service = new SyncQueueService({
      syncRun: { findFirst, findFirstOrThrow: findFirst, create },
      webhookEvent: { updateMany },
    } as never);

    const result = await service.enqueue('connection-1', {
      triggerEventId: 'event-b',
      triggerEventType: 'transactions/created',
    });

    expect(result).toMatchObject({ id: 'queued-1', status: 'QUEUED' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { connectionId: 'connection-1', status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ connectionId: 'connection-1', status: 'QUEUED' }),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { provider: 'PLUGGY', eventId: 'event-b' },
      data: { connectionId: 'connection-1', syncRunId: 'queued-1' },
    });
  });

  it('coalesces multiple webhooks into the single QUEUED run', async () => {
    const queued = { id: 'queued-1', status: 'QUEUED' };
    const findFirst = jest.fn().mockResolvedValue(queued);
    const create = jest.fn();
    const updateMany = jest.fn();
    const service = new SyncQueueService({
      syncRun: { findFirst, findFirstOrThrow: findFirst, create },
      webhookEvent: { updateMany },
    } as never);

    await service.enqueue('connection-1', { triggerEventId: 'event-b' });
    await service.enqueue('connection-1', { triggerEventId: 'event-c' });

    expect(create).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { provider: 'PLUGGY', eventId: 'event-b' },
      data: { connectionId: 'connection-1', syncRunId: 'queued-1' },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { provider: 'PLUGGY', eventId: 'event-c' },
      data: { connectionId: 'connection-1', syncRunId: 'queued-1' },
    });
  });

  it('recovers the queued run after a concurrent unique-constraint race', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'queued-2', status: 'QUEUED' });
    const create = jest.fn().mockRejectedValue(duplicate);
    const updateMany = jest.fn();
    const service = new SyncQueueService({
      syncRun: { findFirst, findFirstOrThrow: findFirst, create },
      webhookEvent: { updateMany },
    } as never);

    await expect(
      service.enqueue('connection-1', { triggerEventId: 'event-d' }),
    ).resolves.toMatchObject({ id: 'queued-2', status: 'QUEUED' });
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { connectionId: 'connection-1', status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });
  });
});
