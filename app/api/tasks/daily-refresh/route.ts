import { getDb } from '@/db';
import { jsonHeaders, refreshWeek, todayChina } from '@/lib/reits';

export const maxDuration = 300;

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET || '';
  if (!expected || authorization !== `Bearer ${expected}`) {
    return Response.json({ message: '定时刷新密钥错误或尚未配置。' }, { status: 401, headers: jsonHeaders() });
  }
  const payload = await refreshWeek(getDb(), todayChina(), { generateBriefs: true, trigger: 'scheduled' });
  return Response.json(payload, {
    status: payload.status === 'ok' ? 200 : 502,
    headers: jsonHeaders(),
  });
}
