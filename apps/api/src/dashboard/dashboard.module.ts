import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceHealthModule } from '../finance-health/finance-health.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, FinanceHealthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
