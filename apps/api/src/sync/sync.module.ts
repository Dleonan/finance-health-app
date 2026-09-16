import { Module } from '@nestjs/common';
import { FinanceHealthModule } from '../finance-health/finance-health.module';
import { PluggyIntegrationModule } from '../integrations/pluggy/pluggy.module';
import { SyncQueueService } from './sync-queue.service';
import { SyncService } from './sync.service';
import { SyncWorkerService } from './sync-worker.service';

@Module({
  imports: [PluggyIntegrationModule, FinanceHealthModule],
  providers: [SyncQueueService, SyncService, SyncWorkerService],
  exports: [SyncQueueService, SyncService],
})
export class SyncModule {}
