import assert from 'node:assert/strict';
import test from 'node:test';
import { visitorAuthResponse, type VisitorAuthProvider, type VisitorUser } from '../lib/blackboard-auth.ts';
import { visitorBlackboardResponse } from '../lib/blackboard-api.ts';
import { BlackboardError } from '../lib/blackboard.ts';

const account: VisitorUser = { id: 'public-test-account', email: 'visitor@example.com' };

function fixture() {
  let user: VisitorUser | null = null;
  const calls: string[] = [];
  const auth: VisitorAuthProvider = {
    async currentUser() { calls.push('read-verified-user'); return user; },
    async sendCode(email) { calls.push(`send:${email}`); },
    // This disposable mock never creates or checks any actual login credential.
    async verifyCode(email) { calls.push(`verify:${email}`); user = account; },
    async signOut() { calls.push('sign-out'); user = null; },
  };
  return { auth, calls, provider: async () => auth };
}

function request(input?: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/blackboard/auth', input === undefined ? undefined : {
    method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
}

void test('登录状态来自服务端已验证用户，验证码确认和退出仅返回公开账号资料', async () => {
  const { provider, calls } = fixture();
  assert.deepEqual(await (await visitorAuthResponse(request(), provider)).json(), { user: null });
  const sent = await visitorAuthResponse(request({ action: 'send-code', email: ' visitor@example.com ' }), provider);
  assert.equal(sent.status, 200);
  assert.equal(sent.headers.get('cache-control'), 'no-store');
  assert.match((await sent.json()).message, /验证码已发送/);
  // 000000 is an inert placeholder accepted only by this in-memory mock.
  const verified = await visitorAuthResponse(request({ action: 'verify-code', email: account.email, code: '000000' }), provider);
  assert.deepEqual(await verified.json(), { user: account });
  assert.deepEqual((await (await visitorAuthResponse(request(), provider)).json()).user, account);
  const signedOut = await visitorAuthResponse(request({ action: 'sign-out' }), provider);
  assert.equal((await signedOut.json()).user, null);
  assert.equal((await (await visitorAuthResponse(request(), provider)).json()).user, null);
  assert.ok(calls.includes('send:visitor@example.com'));
  assert.ok(calls.includes('verify:visitor@example.com'));
});

void test('跨站、缺少Origin或非JSON写入均先拒绝，登录服务和留言数据库不被调用', async () => {
  let opened = 0;
  const provider = async (): Promise<VisitorAuthProvider> => { opened++; throw new Error('must not open'); };
  const db = () => { opened++; throw new Error('must not open'); };
  const identity = async () => { opened++; return { subject: account.id }; };
  const attempts: Record<string, string>[] = [{ origin: 'https://other.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }];
  for (const headers of attempts) {
    const login = await visitorAuthResponse(request({ action: 'send-code', email: account.email }, headers), provider);
    assert.ok([403, 415].includes(login.status));
    const board = await visitorBlackboardResponse(request({ action: 'send', id: 'message', body: 'private' }, headers), { identity, db });
    assert.ok([403, 415].includes(board.status));
  }
  assert.equal(opened, 0);
});

void test('无效邮箱、验证码、未知操作和异常JSON不调用登录服务', async () => {
  let opened = 0;
  const provider = async (): Promise<VisitorAuthProvider> => { opened++; throw new Error('must not open'); };
  for (const input of [null, [], { action: 'unknown' }, { action: 'send-code', email: 'invalid' },
    { action: 'verify-code', email: account.email, code: 'REDACTED' }, { action: 'verify-code', email: account.email, code: '0' }])
    assert.equal((await visitorAuthResponse(request(input), provider)).status, 400);
  const malformed = new Request('https://example.com/api/blackboard/auth', {
    method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{',
  });
  assert.equal((await visitorAuthResponse(malformed, provider)).status, 400);
  assert.equal(opened, 0);
});

void test('未配置、服务故障、过期验证码及限流明确失败，不虚报登录成功', async () => {
  const unavailable = async (): Promise<VisitorAuthProvider> => { throw new BlackboardError(503, '访客登录暂未开放，私密留言尚不可用。'); };
  assert.equal((await visitorAuthResponse(request(), unavailable)).status, 503);
  const { auth } = fixture();
  const missingUser = await visitorAuthResponse(request({ action: 'verify-code', email: account.email, code: '000000' }),
    async () => ({ ...auth, currentUser: async () => null }));
  assert.equal(missingUser.status, 401);
  const failed = await visitorAuthResponse(request(), async () => { throw new Error('internal diagnostic must not be returned'); });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('internal diagnostic'), false);
  const expired = await visitorAuthResponse(request({ action: 'verify-code', email: account.email, code: '000000' }),
    async () => ({ ...auth, verifyCode: async () => { throw new BlackboardError(400, '验证码无效或已过期，请重新获取。'); } }));
  assert.equal(expired.status, 400);
  const limited = await visitorAuthResponse(request({ action: 'send-code', email: account.email }),
    async () => ({ ...auth, sendCode: async () => { throw new BlackboardError(429, '请稍后重试。'); } }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('cache-control'), 'no-store');
});
