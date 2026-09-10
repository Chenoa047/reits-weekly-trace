import { getDb } from '@/db';
import { archiveCurrentWeek, assertAdmin, jsonHeaders, todayChina } from '@/lib/reits';

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const payload = await archiveCurrentWeek(getDb(), todayChina());
  return Response.json(payload, { headers: jsonHeaders() });
}
