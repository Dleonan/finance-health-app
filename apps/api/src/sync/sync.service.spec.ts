import Decimal from 'decimal.js';
import { ProviderDataError } from '../integrations/pluggy/pluggy.adapter';
import { MetricsService } from '../observability/metrics.service';
import { SyncService } from './sync.service';

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
    const prisma = {
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
          webhookEvents: [],
        }),
        update: syncRunUpdate,
      },
      connection: { update: connectionUpdate },
      webhookEvent: { updateMany: webhookUpdateMany },
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
    const prisma = {
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
});
