import { getDb } from '@/db';
import { archiveCurrentWeek, assertAdmin, jsonHeaders, todayChina } from '@/lib/reits';

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  try {
    const payload = await archiveCurrentWeek(getDb(), todayChina());
    return Response.json(payload, { headers: jsonHeaders() });
  } catch (error) {
    const empty = error instanceof Error && error.message === 'empty_archive';
    return Response.json(
      { message: empty ? '本周暂无正式简报可归档，已有历史快照保持不变。' : '归档保存失败，请稍后重试。' },
      { status: empty ? 400 : 503, headers: jsonHeaders() },
    );
  }
}
