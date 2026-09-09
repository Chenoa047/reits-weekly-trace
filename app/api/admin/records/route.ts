import { env } from 'cloudflare:workers';
import { assertAdmin, deleteRecord, jsonHeaders, listCurrentWeek, saveAdminRecord, type ReitsRecord } from '@/lib/reits';

export async function GET(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const payload = await listCurrentWeek(env.DB);
  return Response.json(payload, { headers: jsonHeaders() });
}

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const record = (await request.json()) as ReitsRecord;
  await saveAdminRecord(env.DB, normalizeRecord(record));
  return Response.json({ ok: true }, { headers: jsonHeaders() });
}

export async function DELETE(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return Response.json({ message: '缺少项目 ID。' }, { status: 400, headers: jsonHeaders() });
  }
  await deleteRecord(env.DB, id);
  return Response.json({ ok: true }, { headers: jsonHeaders() });
}

function normalizeRecord(record: ReitsRecord): ReitsRecord {
  const now = new Date().toISOString().slice(0, 10);
  return {
    ...record,
    id: record.id || `manual-${crypto.randomUUID()}`,
    exchange: record.exchange || '上交所',
    fullName: record.fullName || record.shortName || record.title,
    shortName: record.shortName || record.title,
    title: record.title || `${record.shortName}项目动态`,
    status: record.status || record.progressType || '待核验',
    progressType: record.progressType || record.status || '待核验',
    updateDate: record.updateDate || now,
    weekStart: record.weekStart || now,
    weekEnd: record.weekEnd || now,
    brief: record.brief || '管理员新增项目，简报内容待补充。',
    files: record.files || [],
    sourceHtml: record.sourceHtml || '<h3>对应原文摘录</h3><p>管理员新增项目，原文摘录待补充。</p>',
  };
}
