import { BlackboardError, blackboardErrorResponse } from './blackboard.ts';
import { assertBlackboardOrigin, blackboardInput } from './blackboard-request.ts';

export type VisitorUser = { id: string; email: string };

export type VisitorAuthProvider = {
  currentUser: () => Promise<VisitorUser | null>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

function loginEmail(value: unknown) {
  if (typeof value !== 'string' || value.trim().length > 254 || !/^\S+@\S+\.\S+$/.test(value.trim()))
    throw new BlackboardError(400, '请输入有效的登录邮箱。');
  return value.trim();
}

export async function visitorAuthResponse(request: Request, provider: () => Promise<VisitorAuthProvider>) {
  try {
    if (request.method !== 'GET' && request.method !== 'POST') throw new BlackboardError(405, '不支持的请求方式。');
    if (request.method === 'POST') assertBlackboardOrigin(request);
    const input = request.method === 'POST' ? await blackboardInput(request) : null;
    if (input && !['send-code', 'verify-code', 'sign-out'].includes(String(input.action)))
      throw new BlackboardError(400, '不支持的登录操作。');
    const email = input && input.action !== 'sign-out' ? loginEmail(input.email) : '';
    if (input?.action === 'verify-code' && (typeof input.code !== 'string' || !/^\d{6,10}$/.test(input.code)))
      throw new BlackboardError(400, '请输入邮件中的完整数字验证码。');
    const auth = await provider();
    const headers = { 'cache-control': 'no-store' };
    if (!input) return Response.json({ user: await auth.currentUser() }, { headers });
    if (input.action === 'send-code') {
      await auth.sendCode(email);
      return Response.json({ message: '验证码已发送，请查看邮箱。' }, { headers });
    }
    if (input.action === 'sign-out') {
      await auth.signOut();
      return Response.json({ user: null, message: '已退出访客账号。' }, { headers });
    }
    await auth.verifyCode(email, input.code as string);
    const user = await auth.currentUser();
    if (!user) throw new BlackboardError(401, '尚未确认登录成功，请重新登录。');
    return Response.json({ user }, { headers });
  } catch (error) {
    return blackboardErrorResponse(error instanceof BlackboardError ? error
      : new BlackboardError(503, '访客登录服务暂时不可用，请稍后重试。'));
  }
}
