import type { AppDb } from '@/db';

export type RefreshTrigger = 'scheduled' | 'manual';
export type RefreshRunStatus = 'queued' | 'running' | 'ok' | 'partial' | 'failed';

export type RefreshRun = {
  id: string;
  started_at: string;
  finished_at?: string | null;
  status: RefreshRunStatus;
  trigger: RefreshTrigger | 'legacy';
  cnb_build_id?: string | null;
  week_start: string;
  week_end: string;
  sse_count: number;
  szse_count: number;
  message?: string | null;
};

const LOCK_ID = 'global-refresh';
const LOCK_TTL_MS = 3 * 60 * 60 * 1000;

export async function queueRefreshRun(
  db: AppDb,
  range: { start: string; end: string },
) {
  await expireStaleRefreshRuns(db);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const locked = await acquireRefreshLock(db, runId, startedAt);
  if (!locked) return { ok: false as const, active: await activeRefreshRun(db) };

  try {
    await db
      .prepare(
        `INSERT INTO fetch_runs
         (id, started_at, status, trigger, week_start, week_end, message)
         VALUES (?, ?, 'queued', 'manual', ?, ?, ?)`,
      )
      .bind(runId, startedAt, range.start, range.end, '管理员手动更新：任务已提交，等待 CNB 执行。')
      .run();
    return { ok: true as const, runId };
  } catch (error) {
    await releaseRefreshLock(db, runId);
    throw error;
  }
}

export async function beginScheduledRefreshRun(
  db: AppDb,
  range: { start: string; end: string },
) {
  await expireStaleRefreshRuns(db);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const locked = await acquireRefreshLock(db, runId, startedAt);
  if (!locked) return { ok: false as const, active: await activeRefreshRun(db) };

  try {
    await db
      .prepare(
        `INSERT INTO fetch_runs
         (id, started_at, status, trigger, week_start, week_end, message)
         VALUES (?, ?, 'running', 'scheduled', ?, ?, ?)`,
      )
      .bind(runId, startedAt, range.start, range.end, '定时任务：开始抓取交易所数据。')
      .run();
    return { ok: true as const, runId };
  } catch (error) {
    await releaseRefreshLock(db, runId);
    throw error;
  }
}

export async function startQueuedRefreshRun(db: AppDb, runId: string) {
  const now = new Date().toISOString();
  const locked = await acquireRefreshLock(db, runId, now);
  if (!locked) return false;
  const result = await db
    .prepare(
      `UPDATE fetch_runs
       SET status = 'running', message = '管理员手动更新：CNB 已开始抓取交易所数据。'
       WHERE id = ? AND status = 'queued' AND trigger = 'manual'`,
    )
    .bind(runId)
    .run();
  return result.rowsAffected === 1;
}

export async function updateRefreshRunBuildId(db: AppDb, runId: string, buildId: string) {
  await db.prepare('UPDATE fetch_runs SET cnb_build_id = ? WHERE id = ?').bind(buildId, runId).run();
}

export async function finishRefreshRun(
  db: AppDb,
  runId: string,
  values: {
    status: Exclude<RefreshRunStatus, 'queued' | 'running'>;
    sseCount?: number;
    szseCount?: number;
    message: string;
  },
) {
  await db
    .prepare(
      `UPDATE fetch_runs
       SET finished_at = ?, status = ?, sse_count = ?, szse_count = ?, message = ?
       WHERE id = ?`,
    )
    .bind(
      new Date().toISOString(),
      values.status,
      values.sseCount || 0,
      values.szseCount || 0,
      values.message,
      runId,
    )
    .run();
  await releaseRefreshLock(db, runId);
}

export async function refreshRunById(db: AppDb, runId: string) {
  await expireStaleRefreshRuns(db);
  return db.prepare('SELECT * FROM fetch_runs WHERE id = ? LIMIT 1').bind(runId).first<RefreshRun>();
}

export async function activeRefreshRun(db: AppDb) {
  await expireStaleRefreshRuns(db);
  return db
    .prepare(
      `SELECT * FROM fetch_runs
       WHERE status IN ('queued', 'running')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .first<RefreshRun>();
}

export async function expireStaleRefreshRuns(db: AppDb, now = new Date()) {
  const cutoff = new Date(now.getTime() - LOCK_TTL_MS).toISOString();
  const finishedAt = now.toISOString();
  await db
    .prepare(
      `UPDATE fetch_runs
       SET finished_at = ?, status = 'failed',
           message = COALESCE(message, '') || ' 任务超过三小时未完成，已自动标记为失败，可重新发起。'
       WHERE status IN ('queued', 'running') AND started_at <= ?`,
    )
    .bind(finishedAt, cutoff)
    .run();
}

async function acquireRefreshLock(db: AppDb, runId: string, acquiredAt: string) {
  const expiresAt = new Date(Date.parse(acquiredAt) + LOCK_TTL_MS).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO refresh_locks (id, run_id, acquired_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         run_id = excluded.run_id,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at
       WHERE refresh_locks.expires_at <= ? OR refresh_locks.run_id = ?`,
    )
    .bind(LOCK_ID, runId, acquiredAt, expiresAt, acquiredAt, runId)
    .run();
  return result.rowsAffected === 1;
}

async function releaseRefreshLock(db: AppDb, runId: string) {
  await db.prepare('DELETE FROM refresh_locks WHERE id = ? AND run_id = ?').bind(LOCK_ID, runId).run();
}
