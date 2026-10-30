/**
 * Interface for cooperative turn scheduler.
 */
export interface ICooperativeScheduler {
  enqueueTurn<T>(task: () => Promise<T>): Promise<T>;
  getPendingCount(): number;
  isBusy(): boolean;
}

/**
 * Cooperative turn scheduler processing cognitive tasks sequentially in FIFO order.
 * Ensures turns do not interleave unpredictably or starve the event loop.
 */
export class CooperativeTurnScheduler implements ICooperativeScheduler {
  private queue: Array<() => Promise<void>> = [];
  private processing: boolean = false;

  getPendingCount(): number {
    return this.queue.length;
  }

  isBusy(): boolean {
    return this.processing;
  }

  enqueueTurn<T>(task: () => Promise<T>): Promise<T> {
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
    // Yield to the event loop before running the next turn
    setTimeout(() => {
      this.processNext();
    }, 0);
  }
}
