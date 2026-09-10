import { env } from 'cloudflare:workers';
import { assertAdmin, jsonHeaders, refreshWeek, todayChina } from '@/lib/reits';

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const payload = await refreshWeek(env.DB, todayChina(), { generateBriefs: true, forceGenerate: true });
  return Response.json(payload, { headers: jsonHeaders() });
}
