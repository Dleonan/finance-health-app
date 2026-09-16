import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
