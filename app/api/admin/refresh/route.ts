import { getDb } from '@/db';
import { assertAdmin, jsonHeaders, refreshWeek, todayChina } from '@/lib/reits';

export const maxDuration = 300;

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const payload = await refreshWeek(getDb(), todayChina(), {
    generateBriefs: true,
    forceGenerate: true,
    trigger: 'manual',
  });
  return Response.json(payload, {
    status: payload.status === 'ok' ? 200 : 502,
    headers: jsonHeaders(),
  });
}
