/**
 * Sliding-window leaky bucket rate limiter.
 *
 * Guarantees that proactive/autonomous agent cycles never exceed a hard ceiling
 * (default: 5 runs/hour when user is idle), preventing runaway loops.
 */
export class ProactiveRateLimiter {
  private readonly maxPerHour: number | (() => number);
  private readonly windowMs: number = 60 * 60 * 1000; // 1 hour
  private timestamps: number[] = [];

  constructor(maxPerHour: number | (() => number) = 5) {
    this.maxPerHour = typeof maxPerHour === "function" ? maxPerHour : Math.max(1, maxPerHour);
  }

  private getMax(): number {
    const val = typeof this.maxPerHour === "function" ? this.maxPerHour() : this.maxPerHour;
    return Math.max(1, val);
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }

  canAct(nowMs: number = Date.now()): boolean {
    this.prune(nowMs);
    return this.timestamps.length < this.getMax();
  }

  recordAction(nowMs: number = Date.now()): boolean {
    this.prune(nowMs);
    if (this.timestamps.length >= this.getMax()) {
      return false;
    }
    this.timestamps.push(nowMs);
    return true;
  }

  getRemainingBudget(nowMs: number = Date.now()): number {
    this.prune(nowMs);
    return Math.max(0, this.getMax() - this.timestamps.length);
  }

  reset(): void {
    this.timestamps = [];
  }
}
