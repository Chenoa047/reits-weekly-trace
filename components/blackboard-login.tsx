'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { VisitorUser } from '@/lib/blackboard-auth';

type AuthResult = { user?: VisitorUser | null; message?: string };

async function authRequest(input?: Record<string, string>): Promise<AuthResult> {
  let response: Response;
  try {
    response = await fetch('/api/blackboard/auth', {
      cache: 'no-store', ...(input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}),
    });
  } catch { throw new Error('登录服务暂时无法连接，请稍后重试。'); }
  const data = await response.json().catch(() => null) as AuthResult | null;
  if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(data?.message || '登录服务暂时不可用，请稍后重试。');
  if (input?.action === 'send-code' && typeof data.message !== 'string') throw new Error('尚未确认验证码已发送，请重试。');
  if (input?.action !== 'send-code' && (!('user' in data) || (data.user && (typeof data.user.id !== 'string' || typeof data.user.email !== 'string'))))
    throw new Error('尚未确认登录状态，请重试。');
  if (input?.action === 'verify-code' && !data.user) throw new Error('尚未确认登录成功，请重试。');
  if (input?.action === 'sign-out' && data.user !== null) throw new Error('尚未确认退出成功，请重试。');
  return data;
}

export function BlackboardLogin({ children }: { children: (user: VisitorUser) => ReactNode }) {
  const [user, setUser] = useState<VisitorUser | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logoutIncomplete, setLogoutIncomplete] = useState(false);
  const [notice, setNotice] = useState('');
  const revision = useRef(0);
  const acting = useRef(false);
  const leaving = useRef(false);
  const refreshPending = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const load = useCallback(async () => {
    if (acting.current || leaving.current) return;
    const current = ++revision.current;
    setChecking(true);
    try {
      const data = await authRequest();
      if (current !== revision.current) return;
      setUser(data.user || null);
      setAvailable(true);
      setNotice('');
    } catch (error) {
      if (current !== revision.current) return;
      setAvailable(false);
      setNotice(error instanceof Error ? error.message : '暂时无法确认登录状态。');
    } finally { if (current === revision.current) setChecking(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    window.addEventListener('focus', load);
    const listener = (event: MessageEvent) => {
      if (event.data !== 'changed') return;
      revision.current++;
      setUser(null);
      setEmail('');
      setCode('');
      setSent(false);
      if (acting.current) refreshPending.current = true;
      else void load();
    };
    const sessionExpired = () => { setUser(null); void load(); };
    window.addEventListener('blackboard-session-expired', sessionExpired);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('blackboard-login');
      channel.current.addEventListener('message', listener);
    }
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener('focus', load);
      window.removeEventListener('blackboard-session-expired', sessionExpired);
      channel.current?.close();
      channel.current = null;
    };
  }, [load]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function act(action: 'send-code' | 'verify-code' | 'sign-out') {
    if (acting.current) return;
    acting.current = true;
    const current = ++revision.current;
    setChecking(false);
    setBusy(true);
    setNotice('');
    if (action === 'sign-out') {
      leaving.current = true;
      setLogoutIncomplete(true);
      setUser(null);
      setEmail('');
      setCode('');
      setSent(false);
      channel.current?.postMessage('changed');
    }
    try {
      const data = await authRequest(action === 'sign-out' ? { action } : { action, email, ...(action === 'verify-code' ? { code } : {}) });
      if (current !== revision.current) return;
      if (action === 'send-code') {
        setSent(true);
        setCooldown(60);
        setNotice(data.message || '请查看邮箱中的验证码。');
      } else {
        setUser(data.user || null);
        setCode('');
        setSent(false);
        setLogoutIncomplete(false);
        leaving.current = false;
        setNotice(action === 'sign-out' ? '已退出访客账号。' : '登录成功。');
        channel.current?.postMessage('changed');
      }
    } catch (error) { if (current === revision.current) setNotice(error instanceof Error ? error.message : '操作失败，请重试。'); }
    finally {
      acting.current = false;
      setBusy(false);
      if (refreshPending.current) { refreshPending.current = false; void load(); }
    }
  }

  return <>
    {checking ? <output>正在确认访客登录状态…</output> : null}
    {logoutIncomplete ? <div className="blackboard-entry">
      <p>私密对话已隐藏，请确认退出完成后再离开这台设备。</p>
      <button className="btn-muted" disabled={busy} onClick={() => act('sign-out')}>{busy ? '正在退出…' : '重试退出'}</button>
    </div> : user ? <div hidden={!available || checking}>
      <header className="blackboard-toolbar"><span>已登录：{user.email}</span>
        <button className="btn-muted" disabled={busy} onClick={() => act('sign-out')}>退出登录</button></header>
      {children(user)}
    </div> : !checking ? <div className="blackboard-entry">
      <h3>{available ? '邮箱验证码登录' : '访客登录暂未开放'}</h3>
      <p>登录后可在不同设备查看自己的留言与回复。首次登录会自动创建访客账号。</p>
      <form onSubmit={event => { event.preventDefault(); void act(sent ? 'verify-code' : 'send-code'); }}>
        <label htmlFor="blackboard-login-email">登录邮箱</label>
        <input id="blackboard-login-email" className="field" type="email" autoComplete="email" maxLength={254} required
          value={email} disabled={!available || busy} onChange={event => { setEmail(event.target.value); setSent(false); setCode(''); }} />
        {sent ? <>
          <label htmlFor="blackboard-login-code">邮件验证码</label>
          <input id="blackboard-login-code" className="field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10}
            value={code} required disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
        </> : null}
        <button className="btn-primary" type="submit" disabled={!available || busy || (!sent && cooldown > 0)}>
          {busy ? '正在处理…' : sent ? '登录' : cooldown ? `${cooldown}秒后可重新发送` : '发送验证码'}
        </button>
        {sent ? <button className="btn-muted" type="button" disabled={busy || cooldown > 0} onClick={() => act('send-code')}>
          {cooldown ? `${cooldown}秒后可重新发送` : '重新发送验证码'}
        </button> : null}
      </form>
    </div> : null}
    {!available && !checking && !logoutIncomplete ? <button className="btn-muted" onClick={load}>重新检查登录服务</button> : null}
    {notice ? <output className="blackboard-notice">{notice}</output> : null}
  </>;
}
