import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PluggyIntegrationModule } from '../integrations/pluggy/pluggy.module';
import { SyncModule } from '../sync/sync.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  imports: [AuthModule, PluggyIntegrationModule, SyncModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
