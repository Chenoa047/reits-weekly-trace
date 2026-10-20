import { BlackboardError } from './blackboard.ts';

export async function blackboardInput(request: Request): Promise<Record<string, unknown>> {
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input as Record<string, unknown>;
  } catch { throw new BlackboardError(400, '留言请求格式不正确。'); }
}

export function assertBlackboardOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('sec-fetch-site') === 'cross-site')
    throw new BlackboardError(403, '请在本站页面操作小黑板。');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || ''))
    throw new BlackboardError(415, '请使用网站上的留言或登录表单。');
}
