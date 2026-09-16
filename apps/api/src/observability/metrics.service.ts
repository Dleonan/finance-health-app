import { Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, { count: number; totalMs: number }>();
  private readonly pendingCounters = new Map<string, number>();
  private readonly pendingTimings = new Map<string, { count: number; totalMs: number }>();
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async onModuleInit() {
    if (!this.prisma) return;
    try {
      const rows = await this.prisma.metricAggregate.findMany();
      for (const row of rows) {
        this.counters.set(row.name, Number(row.counter));
        if (row.observationCount > 0n)
          this.timings.set(row.name, {
            count: Number(row.observationCount),
            totalMs: Number(row.totalMs),
          });
      }
    } catch {
      this.logger.warn('persistent metrics could not be loaded');
    }
    this.timer = setInterval(() => void this.flush(), 5_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  increment(name: string, amount = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
    this.pendingCounters.set(name, (this.pendingCounters.get(name) ?? 0) + amount);
  }

  observe(name: string, durationMs: number) {
    const current = this.timings.get(name) ?? { count: 0, totalMs: 0 };
    this.timings.set(name, {
      count: current.count + 1,
      totalMs: current.totalMs + Math.max(0, Math.round(durationMs)),
    });
    const pending = this.pendingTimings.get(name) ?? { count: 0, totalMs: 0 };
    this.pendingTimings.set(name, {
      count: pending.count + 1,
      totalMs: pending.totalMs + Math.max(0, Math.round(durationMs)),
    });
  }

  snapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      timings: Object.fromEntries(
        [...this.timings.entries()].map(([name, value]) => [name, { ...value }]),
      ),
    };
  }

  private async flush() {
    if (!this.prisma || this.flushing || (!this.pendingCounters.size && !this.pendingTimings.size))
      return this.flushing;

    const counters = new Map(this.pendingCounters);
    const timings = new Map(this.pendingTimings);
    this.pendingCounters.clear();
    this.pendingTimings.clear();

    this.flushing = this.prisma
      .$transaction(async (tx) => {
        for (const [name, amount] of counters) {
          await tx.metricAggregate.upsert({
            where: { name },
            create: { name, counter: BigInt(amount) },
            update: { counter: { increment: BigInt(amount) } },
          });
        }
        for (const [name, value] of timings) {
          await tx.metricAggregate.upsert({
            where: { name },
            create: {
              name,
              observationCount: BigInt(value.count),
              totalMs: BigInt(value.totalMs),
            },
            update: {
              observationCount: { increment: BigInt(value.count) },
              totalMs: { increment: BigInt(value.totalMs) },
            },
          });
        }
      })
      .catch(() => {
        for (const [name, amount] of counters)
          this.pendingCounters.set(name, (this.pendingCounters.get(name) ?? 0) + amount);
        for (const [name, value] of timings) {
          const current = this.pendingTimings.get(name) ?? { count: 0, totalMs: 0 };
          this.pendingTimings.set(name, {
            count: current.count + value.count,
            totalMs: current.totalMs + value.totalMs,
          });
        }
        this.logger.warn('persistent metrics could not be flushed');
      })
      .finally(() => {
        this.flushing = undefined;
      });
    return this.flushing;
  }
}
