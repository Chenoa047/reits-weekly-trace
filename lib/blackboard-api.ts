import type { AppDb } from '../db/index.ts';
import type { BlackboardVisitorIdentity } from './blackboard-identity.ts';
import { BlackboardError, blackboardErrorResponse, enterBlackboard, visitorThread, sendVisitorMessage } from './blackboard.ts';

export async function blackboardInput(request: Request): Promise<Record<string, unknown>> {
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input as Record<string, unknown>;
  } catch { throw new BlackboardError(400, '留言请求格式不正确。'); }
}

export async function visitorBlackboardResponse(request: Request, dependencies: {
  identity: (request: Request) => Promise<BlackboardVisitorIdentity | null>;
  db: () => AppDb;
}) {
  try {
    const identity = await dependencies.identity(request);
    if (!identity?.subject) throw new BlackboardError(401, '请先登录访客账号，再使用私密留言。');
    // Do not open the database until a verified identity has been supplied.
    const db = dependencies.db();
    let thread;
    if (request.method === 'GET') thread = await visitorThread(db, identity.subject);
    else if (request.method === 'POST') {
      const input = await blackboardInput(request);
      if (input.action === 'enter') thread = await enterBlackboard(db, identity.subject, input);
      else if (input.action === 'send') thread = await sendVisitorMessage(db, identity.subject, input);
      else throw new BlackboardError(400, '不支持的留言操作。');
    } else throw new BlackboardError(405, '不支持的请求方式。');
    return Response.json({ thread }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return blackboardErrorResponse(error); }
}
