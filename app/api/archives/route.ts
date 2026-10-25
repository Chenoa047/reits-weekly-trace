import { getDb } from '@/db';
import { jsonHeaders, listWeeklyArchives, readWeeklyArchive } from '@/lib/reits';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (id !== null && !/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(id)) {
    return Response.json({ message: '归档编号无效。' }, { status: 400, headers: jsonHeaders() });
  }
  try {
    const db = getDb();
    if (id) {
      const archive = await readWeeklyArchive(db, id);
      return archive
        ? Response.json({ archive }, { headers: jsonHeaders() })
        : Response.json({ message: '未找到这期历史周报。' }, { status: 404, headers: jsonHeaders() });
    }
    return Response.json({ archives: await listWeeklyArchives(db) }, { headers: jsonHeaders() });
  } catch {
    return Response.json({ message: '历史周报暂时无法读取，请稍后重试。' }, { status: 503, headers: jsonHeaders() });
  }
}
