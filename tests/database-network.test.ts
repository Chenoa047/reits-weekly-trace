import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbAdapter } from '../db/index.ts';
import { checkDatabaseConnection, databaseFetch } from '../lib/database-network.ts';

void test('数据库预检仅重试可恢复的连接错误，第三次成功后继续', async (t) => {
  let attempts = 0;
  const execute = t.mock.fn(async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError('fetch failed');
    return { rows: [] };
  });
  const wait = t.mock.fn(async (_ms: number) => {});
  const log = t.mock.fn((_message: string) => {});
  const db = createDbAdapter({ execute } as never);
  await checkDatabaseConnection(db, log, wait);
  assert.equal(execute.mock.callCount(), 3);
  assert.deepEqual(wait.mock.calls.map((call) => call.arguments[0]), [1000, 2000]);
  assert.ok(execute.mock.calls.every((call) => (call.arguments as unknown as [{ sql: string }])[0].sql === 'SELECT 1'));
  assert.match(log.mock.calls[0].arguments[0], /CNB.*数据库.*1\/3/);
});

void test('数据库持续断网仅尝试三次，认证或配置问题不重试', async (t) => {
  for (const [message, attempts] of [['fetch failed', 3], ['HTTP 401 unauthorized', 1], ['no such table', 1]] as const) {
    const execute = t.mock.fn(async () => { throw new Error(message); });
    const db = createDbAdapter({ execute } as never);
    await assert.rejects(checkDatabaseConnection(db, () => {}, async () => {}));
    assert.equal(execute.mock.callCount(), attempts);
  }
});

void test('数据库 HTTP 请求设定超时并保留调用方的取消信号，不重试写请求', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout', (_ms: number) => new AbortController().signal);
  const mockFetch = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    assert.ok(init?.signal);
    return new Response('ok');
  });
  const controller = new AbortController();
  controller.abort();
  await databaseFetch(new Request('https://example.invalid/', { method: 'POST', signal: controller.signal }));
  assert.equal(mockFetch.mock.callCount(), 1);
  assert.equal(timeout.mock.calls[0].arguments[0], 15_000);
  assert.equal(mockFetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
});
