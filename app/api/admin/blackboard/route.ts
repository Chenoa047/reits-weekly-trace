import { getDb } from '@/db';
import { assertAdmin } from '@/lib/reits';
import { blackboardInput } from '@/lib/blackboard-api';
import { adminBlackboardThreads, replyToVisitor, blackboardErrorResponse } from '@/lib/blackboard';

export async function GET(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  try {
    const threads = await adminBlackboardThreads(getDb());
    return Response.json({ threads }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return blackboardErrorResponse(error); }
}

export async function POST(request: Request) {
  const blocked = assertAdmin(request);
  if (blocked) return blocked;
  try {
    const thread = await replyToVisitor(getDb(), await blackboardInput(request));
    return Response.json({ thread }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return blackboardErrorResponse(error); }
}
