import { Injectable } from '@nestjs/common';
import { FinancialSummaryService } from '../finance-health/financial-summary.service';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly summary: FinancialSummaryService,
    private readonly metrics: MetricsService,
  ) {}

  async today(userId: string) {
    const startedAt = Date.now();
    try {
      const result = await this.summary.getSummary(userId);
      if (result.dataQuality === 'STALE') this.metrics.increment('connection_stale_total');
      return result;
    } finally {
      this.metrics.observe('dashboard_latency_ms', Date.now() - startedAt);
    }
  }
}
