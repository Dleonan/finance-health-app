import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncQueueService } from './sync-queue.service';
import { SyncService } from './sync.service';

@Injectable()
export class SyncWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncWorkerService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly queue: SyncQueueService,
    private readonly sync: SyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const interval = this.config.get<number>('SYNC_WORKER_INTERVAL_MS', 1_000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const run = await this.queue.claimNext();
      if (run) await this.sync.process(run.id);
    } catch {
      this.logger.error('sync worker tick failed');
    } finally {
      this.busy = false;
    }
  }
}
