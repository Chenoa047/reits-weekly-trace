import { getDb } from '@/db';
import { demoCurrentWeek, jsonHeaders, latestRun, listCurrentWeek, todayChina } from '@/lib/reits';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || todayChina();
  let db;
  try {
    db = getDb();
  } catch {
    return Response.json({ ...demoCurrentWeek(date), latestRun: null }, { headers: jsonHeaders() });
  }
  const payload = await listCurrentWeek(db, date);
  const run = await latestRun(db);
  return Response.json({ ...payload, latestRun: run }, { headers: jsonHeaders() });
}
