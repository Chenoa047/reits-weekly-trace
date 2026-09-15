import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@libsql/client';
import { createDbAdapter } from '../db/index.ts';
import {
  activeRefreshRun,
  expireStaleRefreshRuns,
  finishRefreshRun,
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
