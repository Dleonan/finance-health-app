import { Module } from '@nestjs/common';
import { PluggyAdapter } from './pluggy.adapter';
import { PluggyClientService } from './pluggy.client';

@Module({
  providers: [PluggyClientService, PluggyAdapter],
  exports: [PluggyClientService, PluggyAdapter],
})
export class PluggyIntegrationModule {}
