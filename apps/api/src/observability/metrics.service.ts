import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, { count: number; totalMs: number }>();

  increment(name: string, amount = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  observe(name: string, durationMs: number) {
    const current = this.timings.get(name) ?? { count: 0, totalMs: 0 };
    this.timings.set(name, {
      count: current.count + 1,
      totalMs: current.totalMs + Math.max(0, Math.round(durationMs)),
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
}
