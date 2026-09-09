import { env } from 'cloudflare:workers';
import { jsonHeaders, latestRun, listCurrentWeek, refreshWeek, todayChina } from '@/lib/reits';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || todayChina();
  const refresh = url.searchParams.get('refresh') !== '0';
  if (refresh) {
    await maybeRefresh(date).catch(() => undefined);
  }
  const payload = await listCurrentWeek(env.DB, date);
  const run = await latestRun(env.DB);
  return Response.json({ ...payload, latestRun: run }, { headers: jsonHeaders() });
}

async function maybeRefresh(date: string) {
  const run = await latestRun(env.DB);
  if (!run?.started_at) {
    await refreshWeek(env.DB, date);
    return;
  }
  const age = Date.now() - Date.parse(String(run.started_at));
  if (Number.isFinite(age) && age > 12 * 60 * 60 * 1000) {
    await refreshWeek(env.DB, date);
  }
}
