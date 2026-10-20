'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlackboardThread } from '@/lib/blackboard';

type BoardResponse = { thread?: BlackboardThread | null; threads?: BlackboardThread[]; message?: string };

class BoardRequestError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function boardRequest(url: string, init?: RequestInit): Promise<BoardResponse> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store' }); }
  catch { throw new BoardRequestError(0, '小黑板暂时无法连接，请稍后重试。'); }
  const value: unknown = await response.json().catch(() => null);
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as BoardResponse : {};
  if (!response.ok) throw new BoardRequestError(response.status, data.message || '小黑板暂时无法连接，请稍后重试。');
  if (!('thread' in data) && !Array.isArray(data.threads)) throw new BoardRequestError(502, '留言服务未返回有效结果，请重试。');
  return data;
}

export function BlackboardPanel() {
  const [thread, setThread] = useState<BlackboardThread | null>(null);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pendingMessage = useRef<{ id: string; body: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await boardRequest('/api/blackboard');
      setThread(data.thread || null);
      setAvailable(true);
      setNotice('');
    } catch (error) {
      if (error instanceof BoardRequestError && error.status === 401) setThread(null);
      setAvailable(false);
      setNotice(error instanceof Error ? error.message : '暂时无法读取留言。');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    window.addEventListener('focus', load);
    return () => { window.clearTimeout(initial); window.removeEventListener('focus', load); };
  }, [load]);

  async function enter() {
    if (busy || !available) return;
    setBusy(true);
    try {
      const data = await boardRequest('/api/blackboard', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'enter', nickname, email }),
      });
      if (!data.thread) throw new BoardRequestError(502, '尚未确认对话已保存，请重试。');
      setThread(data.thread || null);
      setNotice('已进入您的私密留言空间。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '暂时无法进入留言空间。'); }
    finally { setBusy(false); }
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy || !available) return;
    const message = pendingMessage.current?.body === body ? pendingMessage.current : { id: crypto.randomUUID(), body };
    pendingMessage.current = message;
    setBusy(true);
    try {
      const data = await boardRequest('/api/blackboard', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send', ...message }),
      });
      if (!data.thread) throw new BoardRequestError(502, '尚未确认留言已保存，内容已保留，请重试。');
      setThread(data.thread || null);
      setDraft('');
      pendingMessage.current = null;
      setNotice('留言已送达，Chenyu 可以在后台查看并回复。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '发送失败，内容已保留，请重试。'); }
    finally { setBusy(false); }
  }

  return (
    <section className="blackboard-shell">
      <aside className="blackboard-intro">
        <span className="blackboard-kicker">PRIVATE MESSAGE BOARD</span>
        <h2>小黑板</h2>
        <p className="blackboard-greeting">给 Chenyu 留言，欢迎交流！</p>
        <p className="blackboard-privacy">与 Chenyu 的私密对话</p>
        <div className="blackboard-demo-note">
          <strong>隐私说明</strong>
          <p>开放后，昵称、邮箱和留言将保存在网站数据库中，仅您与管理员可以查看。邮箱用于联系，不作为读取对话的凭证。</p>
          <p>登录功能接入前暂不接收留言。此前的浏览器演示留言不会自动上传。</p>
        </div>
      </aside>
      <div className="blackboard-workspace">
        {!thread ? (
          <div className="blackboard-entry">
            <h3>{loading ? '正在连接小黑板…' : available ? '进入您的私密留言空间' : '私密留言暂未开放'}</h3>
            <p>登录访客账号后，填写称呼和联系邮箱即可开始对话。</p>
            <label htmlFor="blackboard-nickname">怎么称呼您？</label>
            <input id="blackboard-nickname" className="field" type="text" autoComplete="off" maxLength={30} value={nickname} disabled={!available || busy} onChange={event => setNickname(event.target.value)} />
            <label htmlFor="blackboard-email">联系邮箱</label>
            <input id="blackboard-email" className="field" type="email" autoComplete="email" maxLength={254} value={email} disabled={!available || busy} onChange={event => setEmail(event.target.value)} />
            <button className="btn-primary" onClick={enter} disabled={!available || busy || !nickname.trim() || !email.trim()}>{busy ? '正在进入…' : '进入小黑板'}</button>
          </div>
        ) : (
          <>
            <header className="blackboard-toolbar">
              <div><span>您的私密对话</span><strong>{thread.nickname} · {thread.email}</strong></div>
              <button className="btn-muted" onClick={load} disabled={busy}>刷新回复</button>
            </header>
            <p className="blackboard-demo-guide">留言会送达 Chenyu 的后台；回复会显示在这里。使用同一访客账号可在其他设备继续查看。</p>
            <BlackboardMessages thread={thread} />
            <div className="blackboard-composer">
              <label htmlFor="blackboard-message">写下您的留言</label>
              <textarea id="blackboard-message" className="field" maxLength={500} value={draft} disabled={busy || !available} onChange={event => setDraft(event.target.value)} />
              <div><span>{draft.length}/500</span><button className="btn-primary" onClick={send} disabled={busy || !available || !draft.trim()}>{busy ? '正在发送…' : '发送留言'}</button></div>
            </div>
          </>
        )}
        {!available && !loading ? <button className="btn-muted" onClick={load}>重新检查连接</button> : null}
        {notice ? <output className="blackboard-notice">{notice}</output> : null}
      </div>
    </section>
  );
}

export function AdminBlackboardPanel({ adminPassword }: { adminPassword: string }) {
  const [threads, setThreads] = useState<BlackboardThread[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pendingMessage = useRef<{ id: string; body: string; threadId: string } | null>(null);
  const selected = threads.find(thread => thread.id === selectedId) || threads[0] || null;

  const load = useCallback(async () => {
    try {
      const data = await boardRequest('/api/admin/blackboard', { headers: { 'x-admin-password': adminPassword } });
      const next = data.threads || [];
      setThreads(next);
      setSelectedId(current => current || next[0]?.id || '');
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : '暂时无法读取留言。'); }
    finally { setLoading(false); }
  }, [adminPassword]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    window.addEventListener('focus', load);
    return () => { window.clearTimeout(initial); window.removeEventListener('focus', load); };
  }, [load]);

  async function reply() {
    const body = draft.trim();
    if (!selected || !body || busy) return;
    const previous = pendingMessage.current;
    const message = previous?.body === body && previous.threadId === selected.id ? previous
      : { id: crypto.randomUUID(), body, threadId: selected.id };
    pendingMessage.current = message;
    setBusy(true);
    try {
      const data = await boardRequest('/api/admin/blackboard', {
        method: 'POST', headers: { 'x-admin-password': adminPassword, 'content-type': 'application/json' },
        body: JSON.stringify(message),
      });
      const updated = data.thread;
      if (!updated) throw new BoardRequestError(502, '尚未确认回复已保存，内容已保留，请重试。');
      if (updated) setThreads(current => current.map(thread => thread.id === updated.id ? updated : thread)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setDraft('');
      pendingMessage.current = null;
      setNotice(`已回复 ${selected.nickname}，对方可在自己的留言空间查看。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '回复失败，内容已保留，请重试。'); }
    finally { setBusy(false); }
  }

  return (
    <section className="admin-blackboard">
      <header><div><p>小黑板留言</p><h2>访客留言管理</h2></div>
        <span>{threads.length} 位访客</span><button className="btn-muted" onClick={load} disabled={busy}>刷新留言</button>
      </header>
      <p className="blackboard-demo-guide">访客登录接入后，跨设备收到的留言会统一出现在这里。</p>
      {notice ? <output className="blackboard-notice">{notice}</output> : null}
      {threads.length ? (
        <div className="admin-blackboard-grid">
          <nav className="blackboard-inbox-list" aria-label="留言访客列表">
            {threads.map(thread => <button className={thread.id === selected?.id ? 'active' : ''} key={thread.id} disabled={busy}
              onClick={() => { setSelectedId(thread.id); setDraft(''); pendingMessage.current = null; }}>
              <strong>{thread.nickname}</strong><span>{thread.email}</span><em>{thread.messages.at(-1)?.body || '尚未留言'}</em>
            </button>)}
          </nav>
          {selected ? <div className="admin-blackboard-conversation">
            <div className="admin-blackboard-person"><div><span>当前访客</span><strong>{selected.nickname}</strong></div><small>{selected.email}</small></div>
            <BlackboardMessages thread={selected} />
            <div className="blackboard-composer">
              <label htmlFor="admin-blackboard-reply">回复 {selected.nickname}</label>
              <textarea id="admin-blackboard-reply" className="field" maxLength={500} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
              <div><span>{draft.length}/500</span><button className="btn-primary" onClick={reply} disabled={busy || !draft.trim()}>{busy ? '正在发送…' : '发送回复'}</button></div>
            </div>
          </div> : null}
        </div>
      ) : <div className="blackboard-inbox-empty"><strong>{loading ? '正在读取留言…' : notice ? '留言暂时无法读取' : '暂时没有访客留言'}</strong><p>访客提交留言后，将按昵称显示在这里。</p></div>}
    </section>
  );
}

function BlackboardMessages({ thread }: { thread: BlackboardThread }) {
  return <div className="blackboard-thread" aria-live="polite">
    {thread.messages.length ? thread.messages.map(item => <article className={`blackboard-message ${item.author}`} key={item.id}>
      <div><strong>{item.author === 'chen' ? 'Chenyu' : thread.nickname}</strong>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></div>
      <p>{item.body}</p>
    </article>) : <div className="blackboard-empty"><strong>还没有留言</strong><p>在下方写下想交流的内容。</p></div>}
  </div>;
}
