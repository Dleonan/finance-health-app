import { MetricsService } from './metrics.service';

describe('MetricsService persistence', () => {
  it('loads aggregates and flushes new observations to PostgreSQL', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      metricAggregate: {
        findMany: jest.fn().mockResolvedValue([
          { name: 'webhook_received_total', counter: 4n, observationCount: 0n, totalMs: 0n },
        ]),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ metricAggregate: { upsert } }),
      ),
    };
    const service = new MetricsService(prisma as never);

    await service.onModuleInit();
    service.increment('webhook_received_total');
    service.observe('sync_duration_ms', 12.6);
    await service.onModuleDestroy();

    expect(service.snapshot().counters.webhook_received_total).toBe(5);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'webhook_received_total' },
        update: { counter: { increment: 1n } },
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'sync_duration_ms' },
        create: { name: 'sync_duration_ms', observationCount: 1n, totalMs: 13n },
      }),
    );
  });
});
