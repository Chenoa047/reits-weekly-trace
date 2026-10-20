import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, type InValue } from '@libsql/client';
import { createDbAdapter } from '../db/index.ts';
import {
  activeRefreshRun,
  expireStaleRefreshRuns,
  finishRefreshRun,
  failQueuedRefreshRun,
  failActiveRefreshRun,
  queueRefreshRun,
  refreshRunById,
  startQueuedRefreshRun,
} from '../lib/refresh-runs.ts';

async function testDb() {
  const client = createClient({ url: ':memory:' });
  await client.executeMultiple(`
    CREATE TABLE fetch_runs (
      id TEXT PRIMARY KEY NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      trigger TEXT DEFAULT 'legacy' NOT NULL,
      cnb_build_id TEXT,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      sse_count INTEGER DEFAULT 0 NOT NULL,
      szse_count INTEGER DEFAULT 0 NOT NULL,
      message TEXT
    );
    CREATE TABLE refresh_locks (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return { client, db: createDbAdapter(client) };
}

void test('手动任务按 queued、running、ok 状态转换并在完成后释放锁', async () => {
  const { client, db } = await testDb();
  try {
    const first = await queueRefreshRun(db, { start: '2026-09-14', end: '2026-09-15' });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal((await refreshRunById(db, first.runId))?.status, 'queued');

    const blocked = await queueRefreshRun(db, { start: '2026-09-14', end: '2026-09-15' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.active?.id, first.runId);

    assert.equal(await startQueuedRefreshRun(db, first.runId), true);
    assert.equal((await activeRefreshRun(db))?.status, 'running');
    assert.equal(await startQueuedRefreshRun(db, first.runId), false);
    assert.equal((await queueRefreshRun(db, { start: '2026-09-14', end: '2026-09-15' })).ok, false);

    await finishRefreshRun(db, first.runId, {
      status: 'ok',
      sseCount: 2,
      szseCount: 3,
      message: '完成',
    });
    const completed = await refreshRunById(db, first.runId);
    assert.equal(completed?.status, 'ok');
    assert.equal(completed?.sse_count, 2);
    assert.equal(completed?.szse_count, 3);

    const next = await queueRefreshRun(db, { start: '2026-09-14', end: '2026-09-15' });
    assert.equal(next.ok, true);
  } finally {
    client.close();
  }
});

void test('排队超过十五分钟后明确标记启动确认超时，并释放锁允许重试', async () => {
  const { client, db } = await testDb();
  try {
    const queued = await queueRefreshRun(db, { start: '2026-10-12', end: '2026-10-16' });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const now = new Date();
    await db.prepare('UPDATE fetch_runs SET started_at = ? WHERE id = ?')
      .bind(new Date(now.getTime() - 16 * 60 * 1000).toISOString(), queued.runId).run();
    await expireStaleRefreshRuns(db, now);
    const expired = await refreshRunById(db, queued.runId);
    assert.equal(expired?.status, 'failed');
    assert.match(expired?.message || '', /启动确认超时/);
    assert.equal(await startQueuedRefreshRun(db, queued.runId), false);
    assert.equal((await queueRefreshRun(db, { start: '2026-10-12', end: '2026-10-16' })).ok, true);
  } finally {
    client.close();
  }
});

void test('十五分钟内排队和已运行任务不会被启动超时误判', async () => {
  const { client, db } = await testDb();
  try {
    const queued = await queueRefreshRun(db, { start: '2026-10-12', end: '2026-10-16' });
    if (!queued.ok) return assert.fail('queue failed');
    await expireStaleRefreshRuns(db, new Date(Date.now() + 14 * 60 * 1000));
    assert.equal((await refreshRunById(db, queued.runId))?.status, 'queued');
    assert.equal(await startQueuedRefreshRun(db, queued.runId), true);
    await expireStaleRefreshRuns(db, new Date(Date.now() + 16 * 60 * 1000));
    assert.equal((await refreshRunById(db, queued.runId))?.status, 'running');
  } finally {
    client.close();
  }
});

void test('启动异常可以写回排队任务，但不会覆盖已运行或完成的任务', async () => {
  const { client, db } = await testDb();
  try {
    const queued = await queueRefreshRun(db, { start: '2026-10-12', end: '2026-10-16' });
    if (!queued.ok) return assert.fail('queue failed');
    assert.equal(await failQueuedRefreshRun(db, queued.runId, 'CNB 数据库连接失败。'), true);
    assert.equal((await refreshRunById(db, queued.runId))?.status, 'failed');
    const next = await queueRefreshRun(db, { start: '2026-10-12', end: '2026-10-16' });
    if (!next.ok) return assert.fail('queue failed');
    assert.equal(await startQueuedRefreshRun(db, next.runId), true);
    assert.equal(await failQueuedRefreshRun(db, next.runId, '不应写入'), false);
    assert.equal((await refreshRunById(db, next.runId))?.status, 'running');
    // A late worker must not acquire or release the newer task's lock.
    assert.equal(await startQueuedRefreshRun(db, queued.runId), false);
    assert.equal((await queueRefreshRun(db, { start: '2026-10-12', end: '2026-10-16' })).ok, false);
    await finishRefreshRun(db, next.runId, { status: 'ok', message: '完成' });
    assert.equal(await failQueuedRefreshRun(db, next.runId, '不应覆盖完成状态'), false);
    assert.equal((await refreshRunById(db, next.runId))?.status, 'ok');
  } finally {
    client.close();
  }
});

void test('过期锁不会永久阻止后续抓取', async () => {
  const { client, db } = await testDb();
  try {
    await db
      .prepare('INSERT INTO refresh_locks (id, run_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind('global-refresh', 'abandoned', '2026-01-01T00:00:00.000Z', '2026-01-01T03:00:00.000Z')
      .run();
    const queued = await queueRefreshRun(db, { start: '2026-09-14', end: '2026-09-15' });
    assert.equal(queued.ok, true);
  } finally {
    client.close();
  }
});

void test('超过三小时的排队或运行记录会自动标记失败', async () => {
  const { client, db } = await testDb();
  try {
    await db
      .prepare(
        `INSERT INTO fetch_runs
         (id, started_at, status, trigger, week_start, week_end, message)
         VALUES (?, ?, 'running', 'scheduled', ?, ?, ?)`,
      )
      .bind('stale', '2026-09-15T00:00:00.000Z', '2026-09-14', '2026-09-15', '定时任务运行中。')
      .run();
    await expireStaleRefreshRuns(db, new Date('2026-09-15T04:00:00.000Z'));
    const stale = await refreshRunById(db, 'stale');
    assert.equal(stale?.status, 'failed');
    assert.match(stale?.message || '', /超过三小时/);
  } finally {
    client.close();
  }
});

void test('部分成功是可查询的终态', async () => {
  const { client, db } = await testDb();
  try {
    const queued = await queueRefreshRun(db, { start: '2026-09-14', end: '2026-09-15' });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    await startQueuedRefreshRun(db, queued.runId);
    await finishRefreshRun(db, queued.runId, {
      status: 'partial',
      sseCount: 1,
      message: '上交所成功，深交所失败',
    });
    assert.equal((await refreshRunById(db, queued.runId))?.status, 'partial');
  } finally {
    client.close();
  }
});

void test('进程异常退出可结束运行中任务并释放锁，迟到的完成不能覆盖失败', async () => {
  const { client, db } = await testDb();
  try {
    const queued = await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' });
    if (!queued.ok) return assert.fail('queue failed');
    await startQueuedRefreshRun(db, queued.runId);
    assert.equal(await failActiveRefreshRun(db, queued.runId, '抓取程序异常退出：数据库连接超时。'), true);
    assert.equal((await refreshRunById(db, queued.runId))?.status, 'failed');
    await finishRefreshRun(db, queued.runId, { status: 'ok', message: '迟到的完成' });
    assert.equal((await refreshRunById(db, queued.runId))?.status, 'failed');
    assert.equal((await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' })).ok, true);
  } finally { client.close(); }
});

void test('异常退出回写不覆盖成功结果，也不释放另一任务的锁', async () => {
  const { client, db } = await testDb();
  try {
    const first = await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' });
    if (!first.ok) return assert.fail('queue failed');
    await startQueuedRefreshRun(db, first.runId);
    await finishRefreshRun(db, first.runId, { status: 'ok', message: '完成' });
    const next = await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' });
    if (!next.ok) return assert.fail('queue failed');
    assert.equal(await failActiveRefreshRun(db, first.runId, '迟到的错误'), false);
    await finishRefreshRun(db, first.runId, { status: 'failed', message: '迟到的错误' });
    assert.equal((await refreshRunById(db, first.runId))?.status, 'ok');
    assert.equal((await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' })).ok, false);
  } finally { client.close(); }
});

void test('终态已写入但响应超时时，重试不覆盖结果且仍释放本任务锁', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const status of ['failed', 'ok'] as const) {
    const { client, db } = await testDb();
    try {
      const queued = await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' });
      if (!queued.ok) return assert.fail('queue failed');
      await startQueuedRefreshRun(db, queued.runId);
      let updates = 0;
      const wrapped = createDbAdapter({ execute: async (statement: { sql: string; args: InValue[] }) => {
        const result = await client.execute(statement);
        const sql = statement.sql;
        if (/UPDATE fetch_runs\s+SET (?:status = 'failed'|finished_at =)/.test(sql)) {
          updates++;
          if (updates === 1) throw new Error('database timeout');
        }
        return result;
      } } as never);
      const outcome = status === 'failed'
        ? failActiveRefreshRun(wrapped, queued.runId, '异常退出')
        : finishRefreshRun(wrapped, queued.runId, { status: 'ok', message: '完成' });
      // Wait until the committed update has thrown and the retry timer is scheduled.
      for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.tick(1000);
      await outcome;
      assert.equal(updates, 2);
      assert.equal((await refreshRunById(db, queued.runId))?.status, status);
      assert.equal((await queueRefreshRun(db, { start: '2026-10-19', end: '2026-10-20' })).ok, true);
    } finally { client.close(); }
  }
});
