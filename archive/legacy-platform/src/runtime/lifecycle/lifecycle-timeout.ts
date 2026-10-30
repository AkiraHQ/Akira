import { LifecycleTimeoutError } from "./lifecycle-errors";

/**
 * Executes a promise-returning function with a configurable timeout bound.
 * Throws a LifecycleTimeoutError if the timeout is exceeded.
 */
export async function withTimeout<T>(
  promiseFn: () => Promise<T> | T,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  if (timeoutMs <= 0 || timeoutMs === Infinity) {
    return await promiseFn();
  }

  let timerId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new LifecycleTimeoutError(errorMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promiseFn(), timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timerId);
  }
}
