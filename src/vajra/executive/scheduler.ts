/**
 * Structured error indicating that the cooperative turn scheduler
 * has reached its hard capacity limit and cannot accept additional turns.
 */
export class SchedulerCapacityExceededError extends Error {
  readonly code = "CAPACITY_EXCEEDED";

  constructor(
    message: string,
    readonly pendingCount: number,
    readonly maxCapacity: number,
  ) {
    super(message);
    this.name = "SchedulerCapacityExceededError";
    Object.setPrototypeOf(this, SchedulerCapacityExceededError.prototype);
  }
}

/**
 * Interface for cooperative turn scheduler.
 */
export interface ICooperativeScheduler {
  enqueueTurn<T>(task: () => Promise<T>): Promise<T>;
  getPendingCount(): number;
  getMaxQueueSize(): number;
  isBusy(): boolean;
  stop?(): void;
  isStopped?(): boolean;
  drain?(timeoutMs?: number): Promise<void>;
}

const DEFAULT_MAX_QUEUE_SIZE = 50;

/**
 * Cooperative turn scheduler processing cognitive tasks sequentially in FIFO order.
 * Ensures turns do not interleave unpredictably or starve the event loop.
 *
 * Capacity & Execution Contract:
 * 1. `maxQueueSize` is the maximum number of accepted turns waiting in the queue.
 *    The currently executing turn is excluded from this capacity bound and pending count.
 * 2. The capacity check and enqueue operation are synchronous and atomic.
 * 3. Accepted turns execute in strict FIFO submission order.
 * 4. Over-capacity submissions reject immediately with `SchedulerCapacityExceededError` (`code: "CAPACITY_EXCEEDED"`).
 * 5. Rejected work is never appended to the queue; no rejected closure or unresolved promise is retained.
 * 6. `getPendingCount()` strictly reflects the actual waiting queue (`this.queue.length`).
 * 7. When a queued turn begins execution, freed capacity is immediately available to new submissions.
 * 8. When `stop()` is called, new turn submissions reject immediately. In-flight turns complete,
 *    and `drain(timeoutMs)` waits for in-flight tasks and queued turns to finish.
 */
export class CooperativeTurnScheduler implements ICooperativeScheduler {
  private queue: Array<() => Promise<void>> = [];
  private processing: boolean = false;
  private isStoppedFlag: boolean = false;
  private readonly drainListeners: Array<() => void> = [];
  private readonly maxQueueSize: number;

  constructor(maxQueueSize: number = DEFAULT_MAX_QUEUE_SIZE) {
    this.maxQueueSize = maxQueueSize > 0 ? maxQueueSize : DEFAULT_MAX_QUEUE_SIZE;
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getMaxQueueSize(): number {
    return this.maxQueueSize;
  }

  isBusy(): boolean {
    return this.processing;
  }

  stop(): void {
    this.isStoppedFlag = true;
  }

  isStopped(): boolean {
    return this.isStoppedFlag;
  }

  drain(timeoutMs: number = 5000): Promise<void> {
    if (!this.processing && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const check = () => {
        if (!this.processing && this.queue.length === 0) {
          if (timer) clearTimeout(timer);
          const idx = this.drainListeners.indexOf(check);
          if (idx !== -1) this.drainListeners.splice(idx, 1);
          resolve();
        }
      };

      timer = setTimeout(() => {
        const idx = this.drainListeners.indexOf(check);
        if (idx !== -1) this.drainListeners.splice(idx, 1);
        resolve();
      }, timeoutMs);

      this.drainListeners.push(check);
    });
  }

  enqueueTurn<T>(task: () => Promise<T>): Promise<T> {
    if (this.isStoppedFlag) {
      return Promise.reject(
        new SchedulerCapacityExceededError(
          "Scheduler is stopped; turn rejected.",
          this.queue.length,
          this.maxQueueSize,
        ),
      );
    }

    // Synchronous atomic capacity decision: reject immediately if queue limit reached
    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new SchedulerCapacityExceededError(
          `Scheduler queue capacity of ${this.maxQueueSize} turns reached (${this.queue.length} pending).`,
          this.queue.length,
          this.maxQueueSize,
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };

      this.queue.push(wrappedTask);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const nextTask = this.queue.shift();

    if (nextTask) {
      try {
        await nextTask();
      } catch {
        // Any error in nextTask was already rejected in wrappedTask
      }
    }

    this.processing = false;
    for (const listener of [...this.drainListeners]) {
      try {
        listener();
      } catch {
        // Observers must not fail processing loop
      }
    }
    // Yield to the event loop before running the next turn
    setTimeout(() => {
      this.processNext();
    }, 0);
  }
}
