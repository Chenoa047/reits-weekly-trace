import { getDb } from '@/db';
import { triggerCnbManualRefresh } from '@/lib/cnb';
import { describeRefreshDatabaseError } from '@/lib/refresh-error';
import { assertAdmin, jsonHeaders, latestRun, weekRangeFor } from '@/lib/reits';
import {
  activeRefreshRun,
  finishRefreshRun,
  queueRefreshRun,
  refreshRunById,
  updateRefreshRunBuildId,
} from '@/lib/refresh-runs';

export async function GET(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  try {
    const db = getDb();
    const runId = new URL(request.url).searchParams.get('runId');
    const run = runId
      ? await refreshRunById(db, runId)
      : (await activeRefreshRun(db)) || (await latestRun(db));
    if (!run) {
      return Response.json({ message: '尚无抓取任务记录。' }, { status: 404, headers: jsonHeaders() });
    }
    return Response.json({ run }, { headers: jsonHeaders() });
  } catch (error) {
    return Response.json(
      { message: describeRefreshDatabaseError(error) },
      { status: 503, headers: jsonHeaders() },
    );
  }
}

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  let db;
  let queued;
  try {
    db = getDb();
    queued = await queueRefreshRun(db, weekRangeFor());
  } catch (error) {
    return Response.json(
      { message: describeRefreshDatabaseError(error) },
      { status: 503, headers: jsonHeaders() },
    );
  }
  if (!queued.ok) {
    return Response.json(
      { message: '已有抓取任务正在排队或运行。', run: queued.active },
      { status: 409, headers: jsonHeaders() },
    );
  }

  let buildId: string;
  try {
    ({ buildId } = await triggerCnbManualRefresh(queued.runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CNB 任务触发失败。';
    try {
      await finishRefreshRun(db, queued.runId, {
        status: 'failed',
        message: `管理员手动更新：${message}`,
      });
    } catch (databaseError) {
      return Response.json(
        { message: `${message}；${describeRefreshDatabaseError(databaseError)}` },
        { status: 503, headers: jsonHeaders() },
      );
    }
    return Response.json({ message }, { status: 502, headers: jsonHeaders() });
  }
  try {
    await updateRefreshRunBuildId(db, queued.runId, buildId);
  } catch {
    return Response.json(
      { runId: queued.runId, status: 'queued', message: '任务已提交到 CNB，但构建编号暂未写入数据库；请稍后查看任务状态。' },
      { status: 202, headers: jsonHeaders() },
    );
  }
  return Response.json(
    { runId: queued.runId, status: 'queued', message: '抓取任务已提交到 CNB。' },
    { status: 202, headers: jsonHeaders() },
  );
}
