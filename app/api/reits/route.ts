import { getDb } from '@/db';
import { jsonHeaders, latestRun, listCurrentWeek, refreshWeek, todayChina } from '@/lib/reits';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || todayChina();
  const refresh = url.searchParams.get('refresh') !== '0';
  if (refresh) {
    await maybeRefresh(date).catch(() => undefined);
  }
  const db = getDb();
  const payload = await listCurrentWeek(db, date);
  const run = await latestRun(db);
  return Response.json({ ...payload, latestRun: run }, { headers: jsonHeaders() });
}

async function maybeRefresh(date: string) {
  const db = getDb();
  const run = await latestRun(db);
  if (!run?.started_at) {
    await refreshWeek(db, date);
    return;
  }
  const age = Date.now() - Date.parse(String(run.started_at));
  if (Number.isFinite(age) && age > 12 * 60 * 60 * 1000) {
    await refreshWeek(db, date);
  }
}
