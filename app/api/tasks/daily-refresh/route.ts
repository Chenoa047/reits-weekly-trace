import { jsonHeaders } from '@/lib/reits';

export async function GET() {
  return Response.json(
    { message: '定时抓取已迁移至 CNB，每天北京时间 09:00 执行。' },
    { status: 410, headers: jsonHeaders() },
  );
}
