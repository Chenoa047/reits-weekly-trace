import { jsonHeaders, assertAdmin } from '@/lib/reits';

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  return Response.json({ ok: true }, { headers: jsonHeaders() });
}
