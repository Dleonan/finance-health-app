import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { ProviderDataError } from '../integrations/pluggy/pluggy.adapter';
import { PluggyAdapter } from '../integrations/pluggy/pluggy.adapter';
import { MetricsService } from '../observability/metrics.service';
import { SyncService } from './sync.service';

const makeSyncConnectionHarness = () => {
  const prisma = {
    connection: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'connection-1',
        providerItemId: 'item-1',
        userId: 'user-1',
        lastSyncedAt: null,
      }),
      update: jest.fn(),
    },
    categoryRule: { findMany: jest.fn().mockResolvedValue([]) },
    account: { upsert: jest.fn().mockResolvedValue({ id: 'account-1' }) },
    accountBalanceSnapshot: { upsert: jest.fn() },
    creditCardBill: { upsert: jest.fn() },
    transaction: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    investment: { upsert: jest.fn() },
    investmentSnapshot: { upsert: jest.fn() },
    loan: { upsert: jest.fn() },
  };
  const pluggy = {
    fetchItem: jest.fn().mockResolvedValue({}),
    fetchAccounts: jest.fn().mockResolvedValue([
      {
        id: 'provider-account-1',
        name: 'Conta',
        type: 'CHECKING',
        currency: 'BRL',
        balance: '100.00',
        availableBalance: '100.00',
      },
    ]),
    fetchAllTransactions: jest.fn().mockResolvedValue([]),
    fetchTransactionsByIds: jest.fn().mockResolvedValue([]),
    fetchBills: jest.fn().mockResolvedValue([]),
    fetchInvestments: jest.fn().mockResolvedValue([]),
    fetchLoans: jest.fn().mockResolvedValue([]),
  };
  const service = new SyncService(
    prisma as never,
    pluggy as never,
    new PluggyAdapter(),
    {} as never,
    new MetricsService(),
  );
  return { service, prisma, pluggy };
};

describe('SyncService policies', () => {
  const makeService = (prisma: unknown = {}) =>
    new SyncService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      new MetricsService(),
    );

  it('marks only transactions with a credible recurring cadence and amount', () => {
    const service = makeService();
    const base = new Date('2026-01-01T12:00:00.000Z');
    const transactions = [
      {
        providerTransactionId: 'salary-1',
        merchantRaw: 'ACME LTDA',
        description: 'ACME LTDA',
        amount: '5000.00',
        direction: 'INFLOW' as const,
        postedAt: base,
        isTransfer: false,
        installmentTotal: null,
      },
      {
        providerTransactionId: 'salary-2',
        merchantRaw: 'ACME LTDA',
        description: 'ACME LTDA',
        amount: '5001.00',
        direction: 'INFLOW' as const,
        postedAt: new Date('2026-01-31T12:00:00.000Z'),
        isTransfer: false,
        installmentTotal: null,
      },
      {
        providerTransactionId: 'random',
        merchantRaw: 'ACME LTDA',
        description: 'ACME LTDA',
        amount: '6000.00',
        direction: 'INFLOW' as const,
        postedAt: new Date('2026-03-02T12:00:00.000Z'),
        isTransfer: false,
        installmentTotal: null,
      },
      {
        providerTransactionId: 'installment',
        merchantRaw: 'ACME LTDA',
        description: 'ACME LTDA',
        amount: '5000.00',
        direction: 'INFLOW' as const,
        postedAt: new Date('2026-03-31T12:00:00.000Z'),
        isTransfer: false,
        installmentTotal: 3,
      },
    ];

    const result = service['recurringTransactionIds'](transactions);

    expect(result).toEqual(new Set(['salary-1', 'salary-2']));
  });

  it('matches internal transfers only with currency, timing and signals on both sides', async () => {
    const rows = [
      {
        id: 'outflow-1',
        account: { id: 'checking', currency: 'BRL' },
        direction: 'OUTFLOW',
        amount: new Decimal('250.00'),
        postedAt: new Date('2026-01-10T12:00:00.000Z'),
        description: 'Pix enviado para minha reserva',
        merchantRaw: null,
      },
      {
        id: 'inflow-1',
        account: { id: 'savings', currency: 'BRL' },
        direction: 'INFLOW',
        amount: new Decimal('250.00'),
        postedAt: new Date('2026-01-11T12:00:00.000Z'),
        description: 'Pix recebido',
        merchantRaw: null,
      },
      {
        id: 'false-positive',
        account: { id: 'other', currency: 'BRL' },
        direction: 'INFLOW',
        amount: new Decimal('250.00'),
        postedAt: new Date('2026-01-10T12:00:00.000Z'),
        description: 'Pagamento recebido de terceiro',
        merchantRaw: null,
      },
    ];
    const updateMany = jest.fn();
    const service = makeService({
      transaction: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany,
      },
    });

    await service['detectInternalTransfers']('user-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['outflow-1', 'inflow-1'] } },
      data: { isTransfer: true },
    });
  });

  it('applies bounded exponential backoff and does not retry invalid provider data', () => {
    const service = makeService();

    expect(service['backoffMs'](1)).toBe(5_000);
    expect(service['backoffMs'](2)).toBe(10_000);
    expect(service['backoffMs'](20)).toBe(300_000);
    expect(service['shouldRetry'](new ProviderDataError('invalid'), 'PROVIDER_DATA_INVALID')).toBe(
      false,
    );
    expect(service['shouldRetry']({ statusCode: 503 }, 'SYNC_FAILED')).toBe(true);
    expect(service['shouldRetry']({ statusCode: 400 }, 'SYNC_FAILED')).toBe(false);
  });

  it('preserves the difference between optional empty success and provider failure', async () => {
    const service = makeService();

    await expect(service['optional']('investments', async () => [])).resolves.toEqual({
      status: 'AVAILABLE',
      data: [],
    });
    await expect(
      service['optional']('loans', async () => {
        throw new Error('provider outage');
      }),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      data: null,
      reason: 'LOANS_UNAVAILABLE',
    });
  });

  it('turns item errors into explicit connection product states', async () => {
    const service = makeService();

    await expect(service['handleItemError']('REAUTH_REQUIRED')).resolves.toMatchObject({
      connectionStatus: 'REAUTH_REQUIRED',
      connectionError: { code: 'REAUTH_REQUIRED' },
      dataQuality: 'STALE',
      persistSnapshot: false,
    });
    await expect(service['handleItemError']('UNKNOWN_PROVIDER_ERROR')).resolves.toMatchObject({
      connectionStatus: 'ERROR',
      connectionError: { code: 'UNKNOWN_PROVIDER_ERROR' },
    });
    await expect(service['handleItemDeleted']()).resolves.toMatchObject({
      connectionStatus: 'DISCONNECTED',
      connectionError: { code: 'ITEM_DELETED' },
      dataQuality: 'UNAVAILABLE',
      persistSnapshot: false,
    });
  });

  it('requeues transient provider failures with the run attempt policy', async () => {
    const syncRunUpdate = jest.fn();
    const connectionUpdate = jest.fn();
    const webhookUpdateMany = jest.fn();
    const prisma: unknown = {
      syncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: 'RUNNING',
          attempts: 1,
          connectionId: 'connection-1',
          triggerEventId: null,
          triggerEventType: null,
          resourceId: null,
          errorCode: null,
          connection: { userId: 'user-1' },
          webhookEvents: [
            {
              id: 'event-retry',
              eventType: 'transactions/updated',
              providerErrorCode: null,
              resourceIds: null,
              resourceId: null,
              providerAccountId: 'provider-account-1',
            },
          ],
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: syncRunUpdate,
      },
      connection: { update: connectionUpdate },
      webhookEvent: { updateMany: webhookUpdateMany },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const service = new SyncService(
      prisma as never,
      { fetchItem: jest.fn().mockRejectedValue({ statusCode: 503 }) } as never,
      {} as never,
      {} as never,
      new MetricsService(),
    );

    await service.process('run-1');

    expect(syncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'QUEUED',
          errorCode: 'SYNC_FAILED',
          errorMessage: 'Temporary sync failure; retry scheduled',
        }),
      }),
    );
    expect(connectionUpdate).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: { status: 'PENDING' },
    });
    expect(webhookUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RECEIVED' }) }),
    );
  });

  it('acknowledges item/error without attempting a financial sync', async () => {
    const syncRunUpdate = jest.fn();
    const connectionUpdate = jest.fn();
    const webhookUpdateMany = jest.fn();
    const prisma: unknown = {
      syncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-2',
          status: 'RUNNING',
          attempts: 1,
          connectionId: 'connection-2',
          triggerEventId: 'event-2',
          triggerEventType: 'item/error',
          resourceId: null,
          errorCode: null,
          connection: { userId: 'user-2' },
          webhookEvents: [
            {
              eventType: 'item/error',
              providerErrorCode: 'REAUTH_REQUIRED',
              resourceIds: null,
              resourceId: null,
              providerAccountId: null,
            },
          ],
        }),
        update: syncRunUpdate,
      },
      connection: { update: connectionUpdate },
      webhookEvent: { updateMany: webhookUpdateMany },
    };
    const summary = { persistSnapshot: jest.fn() };
    const service = new SyncService(
      prisma as never,
      { fetchItem: jest.fn() } as never,
      {} as never,
      summary as never,
      new MetricsService(),
    );

    await service.process('run-2');

    expect(summary.persistSnapshot).not.toHaveBeenCalled();
    expect(syncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED', dataQuality: 'STALE' }),
      }),
    );
    expect(connectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'connection-2' },
        data: expect.objectContaining({
          status: 'REAUTH_REQUIRED',
          lastErrorCode: 'REAUTH_REQUIRED',
        }),
      }),
    );
    expect(webhookUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });

  it('keeps updated transaction IDs out of the deleted set', () => {
    const service = makeService();

    expect(
      service['deletedTransactionIds'](
        [
          {
            eventType: 'transactions/updated',
            resourceId: 'TX-A',
            resourceIds: ['TX-A'],
          },
          {
            eventType: 'transactions/deleted',
            resourceId: 'TX-B',
            resourceIds: ['TX-B', 'TX-C', 'TX-B'],
          },
        ],
        null,
        null,
      ),
    ).toEqual(['TX-B', 'TX-C']);
  });

  it('uses window sync when created and updated events are coalesced', () => {
    const service = makeService();

    expect(service['shouldUseTargetedTransactionFetch'](['transactions/updated'], ['TX-A'])).toBe(
      true,
    );
    expect(
      service['shouldUseTargetedTransactionFetch'](
        ['transactions/updated', 'transactions/created'],
        ['TX-A'],
      ),
    ).toBe(false);
  });

  it('executes full transaction fetch for created plus updated events', async () => {
    const { service, pluggy } = makeSyncConnectionHarness();

    await service['syncConnection'](
      'connection-1',
      ['transactions/updated', 'transactions/created'],
      [],
      new Map([['provider-account-1', ['TX-A']]]),
    );

    expect(pluggy.fetchAllTransactions).toHaveBeenCalledTimes(1);
    expect(pluggy.fetchTransactionsByIds).not.toHaveBeenCalled();
  });

  it('executes targeted transaction fetch for an isolated updated event', async () => {
    const { service, pluggy } = makeSyncConnectionHarness();

    await service['syncConnection'](
      'connection-1',
      ['transactions/updated'],
      [],
      new Map([['provider-account-1', ['TX-A']]]),
    );

    expect(pluggy.fetchTransactionsByIds).toHaveBeenCalledWith('provider-account-1', ['TX-A']);
    expect(pluggy.fetchAllTransactions).not.toHaveBeenCalled();
  });

  it('applies deletion only to deleted IDs when updated and deleted events coalesce', async () => {
    const { service, prisma } = makeSyncConnectionHarness();

    await service['syncConnection'](
      'connection-1',
      ['transactions/updated', 'transactions/deleted'],
      ['TX-B'],
      new Map([['provider-account-1', ['TX-A']]]),
    );

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        provider: 'PLUGGY',
        providerTransactionId: { in: ['TX-B'] },
        account: { connectionId: 'connection-1' },
      },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('reports optional provider failures as partial without fabricating empty data', async () => {
    const { service, pluggy } = makeSyncConnectionHarness();
    pluggy.fetchInvestments.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service['syncConnection']('connection-1', [], [], new Map()),
    ).resolves.toMatchObject({
      dataQuality: 'PARTIAL',
      dataQualityReasons: ['INVESTMENTS_UNAVAILABLE'],
      counters: { investmentsProcessed: 0, loansProcessed: 0 },
    });
  });

  it('marks only the webhook event IDs captured in the processed batch', async () => {
    const webhookUpdateMany = jest.fn();
    const prisma: unknown = {
      syncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-3',
          status: 'RUNNING',
          attempts: 1,
          connectionId: 'connection-3',
          triggerEventId: null,
          triggerEventType: 'item/error',
          resourceId: null,
          errorCode: null,
          connection: { userId: 'user-3' },
          webhookEvents: [
            {
              id: 'event-captured',
              eventType: 'item/error',
              providerErrorCode: 'REAUTH_REQUIRED',
              resourceIds: null,
              resourceId: null,
              providerAccountId: null,
            },
          ],
        }),
        update: jest.fn(),
      },
      connection: { update: jest.fn() },
      webhookEvent: { updateMany: webhookUpdateMany },
    };
    const service = makeService(prisma);

    await service.process('run-3');

    expect(webhookUpdateMany).toHaveBeenCalledTimes(2);
    for (const [args] of webhookUpdateMany.mock.calls) {
      expect(args.where).toEqual({
        provider: 'PLUGGY',
        OR: [{ id: { in: ['event-captured'] } }],
      });
    }
  });

  it('coalesces a transient retry into an existing queued run atomically', async () => {
    const eventA = {
      id: 'event-a',
      syncRunId: 'run-a',
      status: 'RECEIVED',
      lastError: null,
      eventType: 'transactions/updated',
      providerErrorCode: null,
      resourceIds: null,
      resourceId: null,
      providerAccountId: 'provider-account-1',
    };
    const eventB = {
      id: 'event-b',
      syncRunId: 'run-b',
      status: 'RECEIVED',
      eventType: 'transactions/created',
      providerErrorCode: null,
      resourceIds: null,
      resourceId: null,
      providerAccountId: 'provider-account-1',
    };
    const laterQueuedAttempt = new Date(Date.now() + 60_000);
    const runA = {
      id: 'run-a',
      status: 'RUNNING',
      attempts: 1,
      connectionId: 'connection-retry',
      triggerEventId: null,
      triggerEventType: 'transactions/updated',
      resourceId: null,
      errorCode: null,
      connection: { userId: 'user-retry' },
      webhookEvents: [eventA],
    };
    const runB = {
      id: 'run-b',
      status: 'QUEUED',
      nextAttemptAt: laterQueuedAttempt,
      webhookEvents: [eventB],
    };
    const syncRunFindFirst = jest.fn().mockResolvedValue(runB);
    const syncRunUpdate = jest.fn().mockImplementation(async ({ where, data }) => {
      Object.assign(where.id === runA.id ? runA : runB, data);
      return where.id === runA.id ? runA : runB;
    });
    const connection = { status: 'SYNCING' };
    const connectionUpdate = jest.fn().mockImplementation(async ({ data }) => {
      Object.assign(connection, data);
    });
    const webhookUpdateMany = jest.fn().mockImplementation(async ({ where, data }) => {
      const ids = where.id?.in ?? where.OR?.[0]?.id?.in ?? [];
      for (const event of [eventA, eventB]) {
        if (ids.includes(event.id)) Object.assign(event, data);
      }
    });
    const prisma: unknown = {
      syncRun: {
        findUnique: jest.fn().mockResolvedValue(runA),
        findFirst: syncRunFindFirst,
        update: syncRunUpdate,
      },
      connection: { update: connectionUpdate },
      webhookEvent: { updateMany: webhookUpdateMany },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const metrics = new MetricsService();
    const service = new SyncService(
      prisma as never,
      { fetchItem: jest.fn().mockRejectedValue({ statusCode: 503 }) } as never,
      {} as never,
      {} as never,
      metrics,
    );

    await expect(service.process('run-a')).resolves.toBeUndefined();

    expect(syncRunFindFirst).toHaveBeenCalledWith({
      where: {
        connectionId: 'connection-retry',
        status: 'QUEUED',
        id: { not: 'run-a' },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(runA.status).toBe('FAILED');
    expect(runA.errorCode).toBe('SYNC_RETRY_COALESCED');
    expect(runB.status).toBe('QUEUED');
    expect(runB.nextAttemptAt).toBeInstanceOf(Date);
    expect((runB.nextAttemptAt as Date).getTime()).toBeLessThanOrEqual(
      laterQueuedAttempt.getTime(),
    );
    expect(eventA.syncRunId).toBe('run-b');
    expect(eventA.status).toBe('RECEIVED');
    expect(eventA.lastError).toBe('SYNC_RETRY_SCHEDULED');
    expect(eventB.syncRunId).toBe('run-b');
    expect(eventB.status).toBe('RECEIVED');
    expect(connection.status).toBe('PENDING');
    expect(metrics.snapshot().counters.sync_retry_scheduled_total).toBe(1);
    expect(metrics.snapshot().counters.sync_failed_total).toBeUndefined();
  });

  it('reprocesses both original and queued webhook batches to success after coalescing', async () => {
    const eventA = {
      id: 'event-a2',
      syncRunId: 'run-a2',
      status: 'RECEIVED',
      lastError: null,
      eventType: 'transactions/updated',
      providerErrorCode: null,
      resourceIds: null,
      resourceId: null,
      providerAccountId: 'provider-account-1',
    };
    const eventB = {
      id: 'event-b2',
      syncRunId: 'run-b2',
      status: 'RECEIVED',
      eventType: 'transactions/created',
      providerErrorCode: null,
      resourceIds: null,
      resourceId: null,
      providerAccountId: 'provider-account-1',
    };
    const runA = {
      id: 'run-a2',
      status: 'RUNNING',
      attempts: 1,
      connectionId: 'connection-retry-2',
      triggerEventId: null,
      triggerEventType: 'transactions/updated',
      resourceId: null,
      errorCode: null,
      connection: { userId: 'user-retry-2' },
      webhookEvents: [eventA],
    };
    const runB = {
      id: 'run-b2',
      status: 'QUEUED',
      nextAttemptAt: null as Date | null,
      triggerEventId: null,
      triggerEventType: 'transactions/created',
      resourceId: null,
      errorCode: null,
      connection: { userId: 'user-retry-2' },
      webhookEvents: [eventB],
    };
    const connection = { status: 'SYNCING' };
    const syncRunUpdate = jest.fn().mockImplementation(async ({ where, data }) => {
      const target = where.id === runA.id ? runA : runB;
      Object.assign(target, data);
      return target;
    });
    const webhookUpdateMany = jest.fn().mockImplementation(async ({ where, data }) => {
      const ids = where.id?.in ?? where.OR?.[0]?.id?.in ?? [];
      for (const event of [eventA, eventB]) {
        if (ids.includes(event.id)) Object.assign(event, data);
      }
    });
    const prisma: unknown = {
      syncRun: {
        findUnique: jest.fn().mockImplementation(({ where }) =>
          where.id === runA.id ? runA : runB,
        ),
        findFirst: jest.fn().mockResolvedValue(runB),
        update: syncRunUpdate,
      },
      connection: {
        update: jest.fn().mockImplementation(async ({ data }) => Object.assign(connection, data)),
      },
      webhookEvent: { updateMany: webhookUpdateMany },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const service = new SyncService(
      prisma as never,
      {} as never,
      {} as never,
      { persistSnapshot: jest.fn() } as never,
      new MetricsService(),
    );
    const successfulOutcome = {
      counters: {
        accountsProcessed: 1,
        transactionsProcessed: 1,
        billsProcessed: 0,
        investmentsProcessed: 0,
        loansProcessed: 0,
      },
      dataQuality: 'COMPLETE',
    };
    jest
      .spyOn(
        service as unknown as { syncConnection: jest.Mock },
        'syncConnection',
      )
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce(successfulOutcome as never);

    await service.process('run-a2');
    runB.status = 'RUNNING';
    runB.webhookEvents = [eventA, eventB];
    await service.process('run-b2');

    expect(runA.status).toBe('FAILED');
    expect(runB.status).toBe('SUCCEEDED');
    expect(eventA.syncRunId).toBe('run-b2');
    expect(eventB.syncRunId).toBe('run-b2');
    expect(eventA.status).toBe('PROCESSED');
    expect(eventB.status).toBe('PROCESSED');
    expect(connection.status).toBe('CONNECTED');
  });

  it('retries the retry transaction when a queued unique constraint race raises P2002', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const transaction = jest
      .fn();
    const prisma: unknown = {
      syncRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'run-b3',
          status: 'QUEUED',
          nextAttemptAt: null,
        }),
        update: jest.fn(),
      },
      connection: { update: jest.fn() },
      webhookEvent: { updateMany: jest.fn() },
      $transaction: transaction,
    };
    transaction
      .mockRejectedValueOnce(duplicate)
      .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(prisma));
    const service = makeService(prisma);

    await expect(
      service['rescheduleTransientFailure'](
        { id: 'run-a3', connectionId: 'connection-retry-3', attempts: 1 },
        ['event-a3'],
        new Date(Date.now() + 5_000),
      ),
    ).resolves.toMatchObject({ coalesced: true, queuedRunId: 'run-b3' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
