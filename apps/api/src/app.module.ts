import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { resolve } from 'node:path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FinanceHealthModule } from './finance-health/finance-health.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConnectionsModule } from './connections/connections.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { CardsModule } from './cards/cards.module';
import { InvestmentsModule } from './investments/investments.module';
import { LoansModule } from './loans/loans.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { validateConfig } from './config/configuration';
import { CategoriesModule } from './categories/categories.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')],
      validate: validateConfig,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    DatabaseModule,
    ObservabilityModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ConnectionsModule,
    AccountsModule,
    TransactionsModule,
    CardsModule,
    InvestmentsModule,
    LoansModule,
    SyncModule,
    WebhooksModule,
    FinanceHealthModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
