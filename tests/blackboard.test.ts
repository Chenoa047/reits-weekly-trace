import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { createDbAdapter } from '../db/index.ts';
import { adminBlackboardThreads, replyToVisitor, enterBlackboard, visitorThread, sendVisitorMessage, blackboardErrorResponse } from '../lib/blackboard.ts';
import { visitorBlackboardResponse } from '../lib/blackboard-api.ts';
import { verifiedBlackboardVisitor } from '../lib/blackboard-identity.ts';

const migration = readFileSync(new URL('../drizzle/0002_blackboard.sql', import.meta.url), 'utf8');
const contact = { nickname: '访客甲', email: 'contact@example.com' };

async function boardDb() {
  const client = createClient({ url: ':memory:' });
  await client.execute('PRAGMA foreign_keys = ON');
  await client.executeMultiple(migration);
  return { client, db: createDbAdapter(client) };
}

function request(input?: unknown, suffix = '') {
  return new Request(`https://example.com/api/blackboard${suffix}`, input === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
}

void test('访客留言持久化，管理员在独立数据库适配器查看回复，同账号在另一设备继续读取', async () => {
  const { client, db } = await boardDb();
  try {
    const deviceA = { identity: async () => ({ subject: 'public-account-a' }), db: () => db };
    const entry = await visitorBlackboardResponse(request({ action: 'enter', ...contact }), deviceA);
    assert.equal(entry.status, 200);
    const sent = await visitorBlackboardResponse(request({ action: 'send', id: 'message-a', body: '请核对估值。' }), deviceA);
    assert.equal(sent.status, 200);
    const inbox = await adminBlackboardThreads(createDbAdapter(client));
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].messages[0].body, '请核对估值。');
    await replyToVisitor(createDbAdapter(client), { threadId: inbox[0].id, id: 'reply-a', body: '已核对并补充。' });
    const deviceB = { identity: async () => ({ subject: 'public-account-a' }), db: () => createDbAdapter(client) };
    const received = await visitorBlackboardResponse(request(), deviceB);
    assert.equal(received.headers.get('cache-control'), 'no-store');
    const result = await received.json();
    assert.deepEqual(result.thread.messages.map((message: { author: string; body: string }) => [message.author, message.body]), [
      ['visitor', '请核对估值。'], ['chen', '已核对并补充。'],
    ]);
    assert.equal(JSON.stringify(result).includes('owner_id'), false);
    assert.equal(JSON.stringify(result).includes('public-account-a'), false);
  } finally { client.close(); }
});

void test('同邮箱的不同账号仍隔离，浏览器提供其他账号、对话或管理员角色不能越权', async () => {
  const { client, db } = await boardDb();
  try {
    const a = await enterBlackboard(db, 'public-account-a', contact);
    await sendVisitorMessage(db, 'public-account-a', { id: 'private-a', body: '甲的私密内容' });
    const b = { identity: async () => ({ subject: 'public-account-b' }), db: () => db };
    const unreadable = await visitorBlackboardResponse(request(undefined, `?ownerId=public-account-a&email=${contact.email}&threadId=${a.id}`), b);
    assert.equal((await unreadable.json()).thread, null);
    await visitorBlackboardResponse(request({ action: 'enter', ...contact, ownerId: 'public-account-a' }), b);
    const response = await visitorBlackboardResponse(request({ action: 'send', id: 'message-b', body: '乙的留言', threadId: a.id, ownerId: 'public-account-a', author: 'chen' }), b);
    const result = await response.json();
    assert.notEqual(result.thread.id, a.id);
    assert.deepEqual(result.thread.messages.map((message: { author: string; body: string }) => [message.author, message.body]), [['visitor', '乙的留言']]);
    assert.equal((await visitorThread(db, 'public-account-a'))?.messages.length, 1);
    assert.equal((await adminBlackboardThreads(db)).length, 2);
  } finally { client.close(); }
});

void test('身份未接入或未登录时先拒绝请求，不连接数据库，也不从邮箱恢复对话', async () => {
  let opened = 0;
  const db = () => { opened++; throw new Error('must not open'); };
  for (const input of [undefined, { action: 'enter', ...contact }, { action: 'send', id: 'a', body: 'hello' }]) {
    const disabled = await visitorBlackboardResponse(request(input), { identity: verifiedBlackboardVisitor, db });
    assert.equal(disabled.status, 503);
    assert.match((await disabled.json()).message, /登录暂未开放/);
    const loggedOut = await visitorBlackboardResponse(request(input), { identity: async () => null, db });
    assert.equal(loggedOut.status, 401);
  }
  assert.equal(opened, 0);
});

void test('昵称邮箱和留言在服务端校验，失败时不产生空对话或超长消息', async () => {
  const { client, db } = await boardDb();
  try {
    for (const input of [{ ...contact, nickname: '' }, { ...contact, nickname: '甲'.repeat(31) }, { ...contact, email: 'invalid' }])
      await assert.rejects(enterBlackboard(db, 'account-a', input));
    assert.equal((await adminBlackboardThreads(db)).length, 0);
    await enterBlackboard(db, 'account-a', contact);
    for (const body of ['', ' ', '字'.repeat(501)]) await assert.rejects(sendVisitorMessage(db, 'account-a', { id: 'message-a', body }));
    assert.equal((await visitorThread(db, 'account-a'))?.messages.length, 0);
    await assert.rejects(replyToVisitor(db, { threadId: 'nonexistent-thread', id: 'reply', body: 'hello' }));
  } finally { client.close(); }
});

void test('网络重发同条消息不会重复，重复编号不能覆盖别人的内容或冒充管理员', async () => {
  const { client, db } = await boardDb();
  try {
    const a = await enterBlackboard(db, 'account-a', contact);
    await enterBlackboard(db, 'account-b', contact);
    for (let attempt = 0; attempt < 2; attempt++) await sendVisitorMessage(db, 'account-a', { id: 'message-a', body: '保留内容' });
    assert.equal((await visitorThread(db, 'account-a'))?.messages.length, 1);
    await assert.rejects(sendVisitorMessage(db, 'account-b', { id: 'message-a', body: '覆盖甲的内容' }));
    await assert.rejects(replyToVisitor(db, { threadId: a.id, id: 'message-a', body: '保留内容' }));
    await assert.rejects(sendVisitorMessage(db, 'account-a', { id: 'message-a', body: '更改原内容' }));
    assert.equal((await visitorThread(db, 'account-a'))?.messages[0].body, '保留内容');
    assert.equal((await visitorThread(db, 'account-b'))?.messages.length, 0);
  } finally { client.close(); }
});

void test('不完整请求和未知操作明确报错，内容中的SQL字符按普通文本保存', async () => {
  const { client, db } = await boardDb();
  try {
    const dependencies = { identity: async () => ({ subject: 'account-a' }), db: () => db };
    assert.equal((await visitorBlackboardResponse(new Request('https://example.com', { method: 'POST', body: '{' }), dependencies)).status, 400);
    assert.equal((await visitorBlackboardResponse(request({ action: 'unknown' }), dependencies)).status, 400);
    assert.equal((await visitorBlackboardResponse(request({ action: 'send', id: 'a', body: 'hello' }), dependencies)).status, 404);
    await enterBlackboard(db, 'account-a', contact);
    const body = "'); DROP TABLE blackboard_threads; -- <script>alert(1)</script>";
    await sendVisitorMessage(db, 'account-a', { id: 'literal-message', body });
    assert.equal((await visitorThread(db, 'account-a'))?.messages[0].body, body);
    assert.equal((await adminBlackboardThreads(db)).length, 1);
  } finally { client.close(); }
});

void test('数据库升级可重复执行，数据库故障只回显固定分类', async () => {
  const { client, db } = await boardDb();
  try {
    await enterBlackboard(db, 'account-a', contact);
    await client.executeMultiple(migration);
    assert.equal((await adminBlackboardThreads(db)).length, 1);
    const missing = blackboardErrorResponse(new Error('no such table: blackboard_threads'));
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).message, /执行留言表迁移/);
    const other = blackboardErrorResponse(new Error('internal-diagnostic-must-not-leak'));
    assert.doesNotMatch(await other.text(), /internal-diagnostic/);
  } finally { client.close(); }
});
