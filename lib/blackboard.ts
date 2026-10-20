import type { AppDb } from '../db/index.ts';

export type BlackboardMessage = {
  id: string;
  author: 'visitor' | 'chen';
  body: string;
  createdAt: string;
};

export type BlackboardThread = {
  id: string;
  nickname: string;
  email: string;
  messages: BlackboardMessage[];
  createdAt: string;
  updatedAt: string;
};

export class BlackboardError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const threadColumns = 'id, nickname, email, created_at, updated_at';

function text(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new BlackboardError(400, `${label}不能为空，且不能超过${max}字。`);
  return value.trim();
}

function rowThread(row: Record<string, unknown>, messages: BlackboardMessage[]): BlackboardThread {
  return { id: String(row.id), nickname: String(row.nickname), email: String(row.email),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), messages };
}

function rowMessage(row: Record<string, unknown>): BlackboardMessage {
  return { id: String(row.id), author: row.author === 'chen' ? 'chen' : 'visitor',
    body: String(row.body), createdAt: String(row.created_at) };
}

async function threadById(db: AppDb, id: string) {
  const row = await db.prepare(`SELECT ${threadColumns} FROM blackboard_threads WHERE id = ?`).bind(id).first();
  if (!row) throw new BlackboardError(404, '没有找到这条对话。');
  const messages = await db.prepare('SELECT id, author, body, created_at FROM blackboard_messages WHERE thread_id = ? ORDER BY created_at, rowid').bind(id).all();
  return rowThread(row, messages.results.map(rowMessage));
}

// ownerId is a public account identifier supplied by verified server-side identity, never an email lookup or a browser-provided identity.
export async function visitorThread(db: AppDb, ownerId: string) {
  const row = await db.prepare('SELECT id FROM blackboard_threads WHERE owner_id = ?').bind(text(ownerId, 255, '账号标识')).first();
  return row ? threadById(db, String(row.id)) : null;
}

export async function enterBlackboard(db: AppDb, ownerId: string, input: Record<string, unknown>) {
  const owner = text(ownerId, 255, '账号标识');
  const nickname = text(input.nickname, 30, '昵称');
  const email = text(input.email, 254, '邮箱');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BlackboardError(400, '请输入有效的邮箱地址。');
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO blackboard_threads (id, owner_id, nickname, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET nickname = excluded.nickname, email = excluded.email`)
    .bind(crypto.randomUUID(), owner, nickname, email, now, now).run();
  return (await visitorThread(db, owner))!;
}

async function appendMessage(db: AppDb, threadId: string, author: BlackboardMessage['author'], input: Record<string, unknown>) {
  const body = text(input.body, 500, '留言内容');
  const id = text(input.id, 80, '消息编号');
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new BlackboardError(400, '消息编号格式不正确。');
  await db.prepare(`INSERT INTO blackboard_messages (id, thread_id, author, body, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, threadId, author, body, new Date().toISOString()).run();
  const saved = await db.prepare('SELECT thread_id, author, body FROM blackboard_messages WHERE id = ?').bind(id).first();
  if (!saved || saved.thread_id !== threadId || saved.author !== author || saved.body !== body)
    throw new BlackboardError(409, '消息编号已被使用，请重新发送。');
  await db.prepare(`UPDATE blackboard_threads SET updated_at = (
    SELECT MAX(created_at) FROM blackboard_messages WHERE thread_id = ?
  ) WHERE id = ?`).bind(threadId, threadId).run();
  return threadById(db, threadId);
}

export async function sendVisitorMessage(db: AppDb, ownerId: string, input: Record<string, unknown>) {
  const thread = await visitorThread(db, ownerId);
  if (!thread) throw new BlackboardError(404, '请先填写昵称和邮箱，进入留言空间。');
  return appendMessage(db, thread.id, 'visitor', input);
}

// These functions must only be called behind the existing administrator access check.
export async function adminBlackboardThreads(db: AppDb) {
  const threads = await db.prepare(`SELECT ${threadColumns} FROM blackboard_threads ORDER BY updated_at DESC, id`).all();
  const messages = await db.prepare('SELECT id, thread_id, author, body, created_at FROM blackboard_messages ORDER BY created_at, rowid').all();
  const byThread = new Map<string, BlackboardMessage[]>();
  for (const row of messages.results) {
    const id = String(row.thread_id);
    const current = byThread.get(id) || [];
    current.push(rowMessage(row));
    byThread.set(id, current);
  }
  return threads.results.map(row => rowThread(row, byThread.get(String(row.id)) || []));
}

export async function replyToVisitor(db: AppDb, input: Record<string, unknown>) {
  const id = text(input.threadId, 80, '对话编号');
  await threadById(db, id);
  return appendMessage(db, id, 'chen', input);
}

export function blackboardErrorResponse(error: unknown) {
  const headers = { 'cache-control': 'no-store' };
  if (error instanceof BlackboardError) return Response.json({ message: error.message }, { status: error.status, headers });
  const missingTable = error instanceof Error && /no such table.*blackboard_/i.test(error.message);
  return Response.json({ message: missingTable
    ? '小黑板数据库尚未升级，请管理员执行留言表迁移。'
    : '小黑板暂时无法连接，请稍后重试。' }, { status: 503, headers });
}
