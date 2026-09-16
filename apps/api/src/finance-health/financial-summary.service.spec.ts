import { DataQuality } from '@prisma/client';
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
  });
});
