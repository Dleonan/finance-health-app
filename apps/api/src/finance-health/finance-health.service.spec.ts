import { FinanceHealthService } from './finance-health.service';
import { MetricsService } from '../observability/metrics.service';

describe('FinanceHealthService', () => {
  const service = new FinanceHealthService(new MetricsService());

  it('does not publish a score when there is no usable data', () => {
    const result = service.calculate({});
    expect(result.score).toBeNull();
    expect(result.coverage).toBeLessThan(0.6);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('calculates a bounded score for a complete preview payload', () => {
    const result = service.calculate({
      monthlyIncome: '10000.00',
      monthlyExpenses: '7000.00',
      essentialMonthlyExpenses: '5000.00',
      liquidAssets: '30000.00',
      monthlyDebtService: '1000.00',
      revolvingOrCardBalance: '2000.00',
      totalCardLimit: '10000.00',
      upcoming30dCommitments: '5000.00',
      historyMonths: 3,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.coverage).toBeGreaterThan(0.6);
    expect(result.version).toBe('fh-v1.0.0');
    expect(
      result.components.every((component) => 'explanation' in component && 'sources' in component),
    ).toBe(true);
  });

  it('treats a zero card limit as unavailable instead of perfect utilization', () => {
    const result = service.calculate({
      monthlyIncome: '1000',
      monthlyExpenses: '500',
      essentialMonthlyExpenses: '500',
      liquidAssets: '1000',
      monthlyDebtService: '0',
      revolvingOrCardBalance: '0',
      totalCardLimit: '0',
      upcoming30dCommitments: '0',
    });
    const card = result.components.find((component) => component.key === 'card_stress');
    expect(card?.score).toBeNull();
    expect(card?.availability).toBe('UNAVAILABLE');
  });

  it('uses observed history for stability only after three complete periods', () => {
    const result = service.calculate({
      monthlyIncome: '10000',
      monthlyExpenses: '7000',
      essentialMonthlyExpenses: '5000',
      liquidAssets: '30000',
      monthlyDebtService: '1000',
      revolvingOrCardBalance: '2000',
      totalCardLimit: '10000',
      upcoming30dCommitments: '5000',
      historyMonths: 3,
      incomeVolatility: '0.10',
      essentialExpenseVolatility: '0.08',
    });
    const stability = result.components.find((component) => component.key === 'stability');
    expect(stability?.score).not.toBeNull();
    expect(stability?.measurement).toBe('0.0900');
  });
});
