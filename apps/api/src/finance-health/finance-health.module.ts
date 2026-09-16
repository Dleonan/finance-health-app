import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceHealthController } from './finance-health.controller';
import { FinancialSummaryService } from './financial-summary.service';
import { FinanceHealthService } from './finance-health.service';

@Module({
  imports: [AuthModule],
  controllers: [FinanceHealthController],
  providers: [FinanceHealthService, FinancialSummaryService],
  exports: [FinanceHealthService, FinancialSummaryService],
})
export class FinanceHealthModule {}
