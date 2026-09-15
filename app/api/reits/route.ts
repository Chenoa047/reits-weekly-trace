import { getDb } from '@/db';
import { jsonHeaders, latestRun, listCurrentWeek, todayChina } from '@/lib/reits';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || todayChina();
  let db;
  try {
    db = getDb();
  } catch {
    return Response.json(
      { message: '网站数据库配置未在运行环境生效。' },
      { status: 503, headers: jsonHeaders() },
    );
  }
  try {
    const payload = await listCurrentWeek(db, date);
    const run = await latestRun(db);
    return Response.json({ ...payload, latestRun: run }, { headers: jsonHeaders() });
  } catch {
    return Response.json(
      { message: '网站无法读取数据库，请稍后重试或联系管理员。' },
      { status: 503, headers: jsonHeaders() },
    );
  }
}
