import { env } from 'cloudflare:workers';
import { jsonHeaders, refreshWeek, todayChina } from '@/lib/reits';

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret') || new URL(request.url).searchParams.get('secret') || '';
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return Response.json({ message: '定时刷新密钥错误或尚未配置。' }, { status: 401, headers: jsonHeaders() });
  }
  const payload = await refreshWeek(env.DB, todayChina());
  return Response.json(payload, { headers: jsonHeaders() });
}
