import { DataQuality } from '@prisma/client';
import Decimal from 'decimal.js';
import { FinanceHealthService } from './finance-health.service';
import { MetricsService } from '../observability/metrics.service';
import { FinancialSummaryService } from './financial-summary.service';

describe('FinancialSummaryService data quality', () => {
  const service = new FinancialSummaryService({} as never, {} as never);
  const account = (status: string, dataQuality: DataQuality | null, currency = 'BRL') => ({
    currency,
    connection: {
      status,
      syncRuns: [{ status: 'SUCCEEDED', dataQuality }],
    },
  });

  it('publishes complete only after a successful complete sync in the base currency', () => {
    expect(service['quality']([account('CONNECTED', DataQuality.COMPLETE)], [{}], false)).toBe(
      DataQuality.COMPLETE,
    );
    expect(service['quality']([account('CONNECTED', DataQuality.PARTIAL)], [{}], false)).toBe(
      DataQuality.PARTIAL,
    );
  });

  it('distinguishes stale connections and missing currency/data from a real zero', () => {
    expect(service['quality']([account('ERROR', DataQuality.COMPLETE)], [{}], false)).toBe(
      DataQuality.STALE,
    );
    expect(service['quality']([account('CONNECTED', DataQuality.COMPLETE, 'USD')], [], false)).toBe(
      DataQuality.PARTIAL,
    );
    expect(service['sumKnown']([])).toBeNull();
    expect(service['sumKnown']([null])).toBeNull();
    expect(service['sumKnown']([], new Decimal(0))?.toFixed(2)).toBe('0.00');
  });

  it('calculates net worth with known zero investments and liabilities', async () => {
    const syncRun = {
      status: 'SUCCEEDED',
      dataQuality: DataQuality.COMPLETE,
      dataQualityReasons: [],
    };
    const account = {
      currency: 'BRL',
      kind: 'CHECKING',
      availableBalance: new Decimal('10000.00'),
      currentBalance: new Decimal('10000.00'),
      connection: {
        status: 'CONNECTED',
        lastSyncedAt: new Date('2026-09-16T12:00:00.000Z'),
        syncRuns: [syncRun],
      },
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user-1',
          timezone: 'America/Sao_Paulo',
          baseCurrency: 'BRL',
        }),
      },
      connection: { findMany: jest.fn().mockResolvedValue([{ status: 'CONNECTED', syncRuns: [syncRun] }]) },
      account: { findMany: jest.fn().mockResolvedValue([account]) },
      investment: { findMany: jest.fn().mockResolvedValue([]) },
      loan: { findMany: jest.fn().mockResolvedValue([]) },
      creditCardBill: { findMany: jest.fn().mockResolvedValue([]) },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
      manualFact: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const summary = new FinancialSummaryService(
      prisma as never,
      new FinanceHealthService(new MetricsService()),
    );

    await expect(summary.getSummary('user-1')).resolves.toMatchObject({
      availableCash: '10000.00',
      investments: '0.00',
      liabilities: '0.00',
      netWorth: '10000.00',
      monthlyIncome: '0.00',
      monthlyExpenses: '0.00',
      creditCardExposure: '0.00',
    });
  });
});
