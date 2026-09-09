import { env } from 'cloudflare:workers';
import { archiveCurrentWeek, assertAdmin, jsonHeaders, todayChina } from '@/lib/reits';

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const payload = await archiveCurrentWeek(env.DB, todayChina());
  return Response.json(payload, { headers: jsonHeaders() });
}
