import { getDb } from '@/db';
import { triggerCnbManualRefresh } from '@/lib/cnb';
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
  const db = getDb();
  const runId = new URL(request.url).searchParams.get('runId');
  const run = runId
    ? await refreshRunById(db, runId)
    : (await activeRefreshRun(db)) || (await latestRun(db));
  if (!run) {
    return Response.json({ message: '尚无抓取任务记录。' }, { status: 404, headers: jsonHeaders() });
  }
  return Response.json({ run }, { headers: jsonHeaders() });
}

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const db = getDb();
  const queued = await queueRefreshRun(db, weekRangeFor());
  if (!queued.ok) {
    return Response.json(
      { message: '已有抓取任务正在排队或运行。', run: queued.active },
      { status: 409, headers: jsonHeaders() },
    );
  }

  try {
    const { buildId } = await triggerCnbManualRefresh(queued.runId);
    await updateRefreshRunBuildId(db, queued.runId, buildId);
    return Response.json(
      { runId: queued.runId, status: 'queued', message: '抓取任务已提交到 CNB。' },
      { status: 202, headers: jsonHeaders() },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CNB 任务触发失败。';
    await finishRefreshRun(db, queued.runId, {
      status: 'failed',
      message: `管理员手动更新：${message}`,
    });
    return Response.json({ message }, { status: 502, headers: jsonHeaders() });
  }
}
