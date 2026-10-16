import type { AppDb } from '../db/index.ts';
import { describeCnbDatabaseError, isTransientDatabaseError } from './refresh-error.ts';

// Bound each HTTP request, but never automatically replay database writes.
export function databaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const signals = [AbortSignal.timeout(15_000)];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
}

export async function checkDatabaseConnection(
  db: AppDb,
  log: (message: string) => void,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log(`CNB 数据库连接检查（${attempt}/3）。`);
    try {
      await db.prepare('SELECT 1').first();
      log('CNB 数据库连接检查通过，开始领取抓取任务。');
      return;
    } catch (error) {
      log(describeCnbDatabaseError(error));
      if (attempt === 3 || !isTransientDatabaseError(error)) throw error;
      await wait(attempt * 1000);
    }
  }
}
