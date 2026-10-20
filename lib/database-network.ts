import type { AppDb } from '../db/index.ts';
import { describeCnbDatabaseError, isTransientDatabaseError } from './refresh-error.ts';

// Bound each HTTP request, but never automatically replay database writes.
export function databaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const signals = [AbortSignal.timeout(15_000)];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
}

// Use only for reads or explicitly idempotent task-state updates, never arbitrary writes.
export async function retryTransientDatabaseOperation<T>(
  operation: () => Promise<T>,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || !isTransientDatabaseError(error)) throw error;
      await wait(attempt * 1000);
    }
  }
}

export async function checkDatabaseConnection(
  db: AppDb,
  log: (message: string) => void,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log(`CNB 数据库连接检查（${attempt}/3）。`);
    try {
      // This loop owns preflight retries; bypass the adapter's automatic read retries.
      await db.prepare('SELECT 1').run();
      log('CNB 数据库连接检查通过，开始领取抓取任务。');
      return;
    } catch (error) {
      log(describeCnbDatabaseError(error));
      if (attempt === 3 || !isTransientDatabaseError(error)) throw error;
      await wait(attempt * 1000);
    }
  }
}
