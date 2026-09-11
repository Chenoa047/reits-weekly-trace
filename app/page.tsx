'use client';

import { useEffect, useMemo, useState } from 'react';

type ReitsFile = {
  label: string;
  url: string;
  kind: string;
};

type ReitsRecord = {
  id: string;
  exchange: '上交所' | '深交所';
  fullName: string;
  shortName: string;
  title: string;
  status: string;
  progressType: string;
  updateDate: string;
  weekStart: string;
  weekEnd: string;
  originator?: string;
  brief: string;
  note?: string;
  files: ReitsFile[];
  sourceHtml: string;
  sourceUrl?: string;
};

type ApiPayload = {
  range: { start: string; end: string };
  records: ReitsRecord[];
  latestRun?: { status?: string; started_at?: string; message?: string; sse_count?: number; szse_count?: number } | null;
};

type VisitorArchive = {
  id: string;
  weekStart: string;
  weekEnd: string;
  savedAt: string;
  records: ReitsRecord[];
};

type BlackboardMessage = {
  id: string;
  author: 'visitor' | 'chen';
  body: string;
  createdAt: string;
};

type BlackboardThread = {
  id: string;
  nickname: string;
  email: string;
  messages: BlackboardMessage[];
  createdAt: string;
  updatedAt: string;
};

const localKey = 'reits-live-visitor-edits-v2';
const visitorArchiveKey = 'reits-visitor-local-archives-v1';
const blackboardKey = 'reits-blackboard-demo-v2';
const blackboardVisitorKey = 'reits-blackboard-demo-visitor-v1';
const blackboardUpdateEvent = 'reits-blackboard-demo-update';

export default function Home() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [records, setRecords] = useState<ReitsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'intro' | 'briefs' | 'blackboard' | 'admin'>('briefs');
  const [typeFilter, setTypeFilter] = useState('全部');
  const [exchangeFilter, setExchangeFilter] = useState('全部');
  const [compareRecord, setCompareRecord] = useState<ReitsRecord | null>(null);
  const [localEdit, setLocalEdit] = useState(false);
  const [visitorArchives, setVisitorArchives] = useState<VisitorArchive[]>([]);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthed, setAdminAuthed] = useState(false);

  useEffect(() => {
    loadData();
    const saved = sessionStorage.getItem('reits-admin-password');
    if (saved) {
      setAdminPassword(saved);
      setAdminAuthed(true);
    }
    setVisitorArchives(readVisitorArchives());
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch('/api/reits');
      const data = (await response.json()) as ApiPayload;
      setPayload(data);
      const local = localStorage.getItem(localKey);
      setRecords(local ? JSON.parse(local) : data.records);
    } catch {
      setMessage('数据读取失败，请稍后刷新。');
    } finally {
      setLoading(false);
    }
  }

  function updateLocalRecord(id: string, patch: Partial<ReitsRecord>) {
    const next = records.map((record) => (record.id === id ? { ...record, ...patch } : record));
    setRecords(next);
    localStorage.setItem(localKey, JSON.stringify(next));
  }

  function openCompareRecord(record: ReitsRecord) {
    setCompareRecord(record);
    window.setTimeout(() => {
      document.getElementById(comparePanelId(record.id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function addLocalRecord() {
    const now = new Date().toISOString().slice(0, 10);
    const next = [
      {
        id: `local-${crypto.randomUUID()}`,
        exchange: '上交所' as const,
        fullName: '新增项目',
        shortName: '新增项目',
        title: '新增项目简报',
        status: '待核验',
        progressType: '待核验',
        updateDate: now,
        weekStart: payload?.range.start || now,
        weekEnd: payload?.range.end || now,
        brief: '新增项目简报内容待编辑。',
        files: [],
        sourceHtml: '<h3>对应原文摘录</h3><p>原文摘录待补充。</p>',
      },
      ...records,
    ];
    setRecords(next);
    localStorage.setItem(localKey, JSON.stringify(next));
  }

  function clearLocalChanges() {
    localStorage.removeItem(localKey);
    setRecords(payload?.records || []);
    setLocalEdit(false);
    setCompareRecord(null);
    setMessage('已清除当前浏览器中的本地修改，并恢复全站正式内容。');
  }

  function saveVisitorArchive() {
    if (!payload) {
      setMessage('本周数据尚未读取完成，暂不能保存本地归档。');
      return;
    }
    const archive: VisitorArchive = {
      id: crypto.randomUUID(),
      weekStart: payload.range.start,
      weekEnd: payload.range.end,
      savedAt: new Date().toISOString(),
      records,
    };
    const next = [archive, ...visitorArchives].slice(0, 24);
    setVisitorArchives(next);
    localStorage.setItem(visitorArchiveKey, JSON.stringify(next));
    setMessage('已保存访客本地归档。该归档只存在当前电脑和浏览器中。');
  }

  function loadVisitorArchive(archive: VisitorArchive) {
    setRecords(archive.records);
    localStorage.setItem(localKey, JSON.stringify(archive.records));
    setLocalEdit(true);
    setMessage(`已载入 ${dotDate(archive.weekStart)} - ${dotDate(archive.weekEnd)} 的访客本地归档。`);
  }

  function deleteVisitorArchive(id: string) {
    const next = visitorArchives.filter((archive) => archive.id !== id);
    setVisitorArchives(next);
    localStorage.setItem(visitorArchiveKey, JSON.stringify(next));
    setMessage('已删除该访客本地归档记录。');
  }

  async function adminLogin() {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: adminHeaders() });
    if (!response.ok) {
      setMessage('管理员密码错误，或生产环境尚未配置 ADMIN_PASSWORD。');
      return;
    }
    sessionStorage.setItem('reits-admin-password', adminPassword);
    setAdminAuthed(true);
    setMessage('已进入后台管理模式。');
  }

  async function adminSave(record: ReitsRecord) {
    const response = await fetch('/api/admin/records', {
      method: 'POST',
      headers: { ...adminHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(record),
    });
    setMessage(response.ok ? '项目已保存到全站数据库。' : '保存失败，请检查管理员密码。');
    if (response.ok) await loadData();
  }

  async function adminDelete(id: string) {
    const response = await fetch(`/api/admin/records?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    setMessage(response.ok ? '项目已从全站数据库删除。' : '删除失败，请检查管理员密码。');
    if (response.ok) await loadData();
  }

  async function adminRefresh() {
    setMessage('正在抓取交易所数据并生成简报...');
    const response = await fetch('/api/admin/refresh', { method: 'POST', headers: adminHeaders() });
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? `抓取完成：${data.message || '已刷新。'}` : '抓取失败，请检查管理员密码或稍后重试。');
    if (response.ok) await loadData();
  }

  async function adminArchive() {
    const response = await fetch('/api/admin/archive', { method: 'POST', headers: adminHeaders() });
    const data = (await response.json().catch(() => ({}))) as { count?: number };
    setMessage(response.ok ? `已归档当前周，共 ${data.count || 0} 条。` : '归档失败，请检查管理员密码。');
    if (response.ok) await loadData();
  }

  function adminHeaders() {
    return { 'x-admin-password': adminPassword };
  }

  const filtered = useMemo(() => {
    return records
      .filter((record) => typeFilter === '全部' || record.progressType === typeFilter)
      .filter((record) => exchangeFilter === '全部' || record.exchange === exchangeFilter)
      .sort((a, b) => b.updateDate.localeCompare(a.updateDate));
  }, [records, typeFilter, exchangeFilter]);

  const types = useMemo(() => ['全部', ...Array.from(new Set(records.map((record) => record.progressType)))], [records]);
  const stats = useMemo(() => buildStats(records), [records]);

  function exportWord() {
    const body = filtered
      .map(
        (record) =>
          `<p class="brief-title">${escapeHtml(record.title)}</p><p class="brief-body">${escapeHtml(record.brief)}</p>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page WordSection1{size:20.99cm 29.7cm;margin:1.27cm;}div.WordSection1{page:WordSection1;}p{font-family:"Times New Roman",SimSun,serif;font-size:12pt;line-height:1.35;margin:6pt 0;}.brief-title{font-weight:bold;mso-outline-level:1;text-align:left;}.brief-body{text-align:justify;text-justify:inter-ideograph;text-indent:2em;}</style></head><body><div class="WordSection1"><h1>公募REITs每周市场动态</h1>${body}</div></body></html>`;
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `REITs一级市场项目跟踪-${payload?.range.start || 'week'}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#f2f2f2] text-[#241f21]">
      <header className="border-b border-[#d8d1cf] bg-gradient-to-r from-white to-[#f7f1e0] px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-sm font-bold text-[#96001e]">内部周报工作台 · 一级市场项目跟踪</p>
            <h1 className="text-3xl font-black tracking-normal">REITs 行业周报工作台</h1>
            <p className="mt-3 max-w-2xl text-base text-[#695f62]">
              自动汇总交易所 REITs 专栏披露信息，按访问日期展示本周一级项目动态。
            </p>
          </div>
          <div className="border border-[#d8d1cf] bg-white px-5 py-4">
            <span className="block text-sm text-[#695f62]">本周数据区间</span>
            <strong className="text-xl">{payload ? `${dotDate(payload.range.start)} - ${dotDate(payload.range.end)}` : '读取中'}</strong>
            <small className="block text-xs text-[#695f62]">按访问日期自动计算</small>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-7 lg:px-12">
        <nav className="site-tabs mb-6" aria-label="工作台栏目">
          <TabButton active={activeTab === 'intro'} onClick={() => setActiveTab('intro')}>功能介绍</TabButton>
          <TabButton active={activeTab === 'briefs'} onClick={() => setActiveTab('briefs')}>简报速递</TabButton>
          <TabButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')}>后台管理</TabButton>
        </nav>

        <button
          className={`blackboard-easter-egg ${activeTab === 'blackboard' ? 'active' : ''}`}
          type="button"
          title="打开小黑板"
          aria-label="打开小黑板"
          onClick={() => setActiveTab('blackboard')}
        >
          <span aria-hidden="true">✎</span><em>小黑板</em>
        </button>

        {message ? <div className="mb-5 border border-[#e0c27c] bg-[#f7f1e0] px-4 py-3 text-sm font-semibold">{message}</div> : null}

        {activeTab === 'intro' ? <IntroPanel /> : null}
        {activeTab === 'briefs' ? (
          <BriefPanel
            loading={loading}
            records={records}
            filtered={filtered}
            stats={stats}
            types={types}
            typeFilter={typeFilter}
            exchangeFilter={exchangeFilter}
            localEdit={localEdit}
            setTypeFilter={setTypeFilter}
            setExchangeFilter={setExchangeFilter}
            setLocalEdit={setLocalEdit}
            visitorArchives={visitorArchives}
            saveVisitorArchive={saveVisitorArchive}
            loadVisitorArchive={loadVisitorArchive}
            deleteVisitorArchive={deleteVisitorArchive}
            updateLocalRecord={updateLocalRecord}
            addLocalRecord={addLocalRecord}
            exportWord={exportWord}
            clearLocalChanges={clearLocalChanges}
            compareRecord={compareRecord}
            setCompareRecord={openCompareRecord}
            clearCompareRecord={() => setCompareRecord(null)}
            latestRun={payload?.latestRun}
          />
        ) : null}
        {activeTab === 'blackboard' ? <BlackboardDemo /> : null}
        {activeTab === 'admin' ? (
          <AdminPanel
            adminPassword={adminPassword}
            setAdminPassword={setAdminPassword}
            adminAuthed={adminAuthed}
            adminLogin={adminLogin}
            records={records}
            adminSave={adminSave}
            adminDelete={adminDelete}
            adminRefresh={adminRefresh}
            adminArchive={adminArchive}
          />
        ) : null}
      </div>
    </main>
  );
}

function BlackboardDemo() {
  const [thread, setThread] = useState<BlackboardThread | null>(null);
  const [draftEmail, setDraftEmail] = useState('');
  const [draftNickname, setDraftNickname] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const threads = readBlackboardThreads();
    const currentId = localStorage.getItem(blackboardVisitorKey);
    const current = threads.find((item) => item.id === currentId) || threads[0] || null;
    if (current) {
      setThread(current);
      setDraftEmail(current.email);
      setDraftNickname(current.nickname);
      localStorage.setItem(blackboardVisitorKey, current.id);
    }
  }, []);

  function enterBlackboard() {
    const email = draftEmail.trim();
    const nickname = draftNickname.trim();
    if (!nickname) {
      setNotice('请先告诉我们怎么称呼您。');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setNotice('请输入有效的邮箱地址。');
      return;
    }
    const threads = readBlackboardThreads();
    const existing = threads.find((item) => item.email.toLowerCase() === email.toLowerCase());
    const now = new Date().toISOString();
    const nextThread = existing
      ? { ...existing, nickname }
      : { id: crypto.randomUUID(), nickname, email, messages: [], createdAt: now, updatedAt: now };
    saveBlackboardThreads(existing ? threads.map((item) => item.id === existing.id ? nextThread : item) : [nextThread, ...threads]);
    localStorage.setItem(blackboardVisitorKey, nextThread.id);
    setThread(nextThread);
    setNotice('已进入您的留言空间。邮箱仅保存在当前浏览器中，不会发送邮件或上传服务器。');
  }

  function sendMessage() {
    const body = draft.trim();
    if (!thread || !body) {
      setNotice('请先填写留言内容。');
      return;
    }
    const now = new Date().toISOString();
    const nextThread = {
      ...thread,
      updatedAt: now,
      messages: [...thread.messages, { id: crypto.randomUUID(), author: 'visitor' as const, body, createdAt: now }],
    };
    const threads = readBlackboardThreads().map((item) => item.id === thread.id ? nextThread : item);
    saveBlackboardThreads(threads);
    setThread(nextThread);
    setDraft('');
    setNotice('留言已保存在当前浏览器中。管理员回复后，您将在这里看到完整记录。');
  }

  useEffect(() => {
    function syncThread() {
      if (!thread) return;
      const current = readBlackboardThreads().find((item) => item.id === thread.id);
      if (current) setThread(current);
    }
    window.addEventListener(blackboardUpdateEvent, syncThread);
    return () => window.removeEventListener(blackboardUpdateEvent, syncThread);
  }, [thread]);

  return (
    <section className="blackboard-shell">
      <aside className="blackboard-intro">
        <span className="blackboard-kicker">PRIVATE MESSAGE BOARD</span>
        <h2>小黑板</h2>
        <p className="blackboard-greeting">给 Chenyu 留言，欢迎交流！</p>
        <p className="blackboard-privacy">留言仅保存在当前设备和浏览器中</p>
        <div className="blackboard-demo-note">
          <strong>隐私说明</strong>
          <p>留言和邮箱仅保存在当前设备的浏览器中，不会上传服务器；清除浏览器数据后无法恢复。</p>
        </div>
      </aside>

      <div className="blackboard-workspace">
        {!thread ? (
          <div className="blackboard-entry">
            <span>第一步</span>
            <h3>进入您的设备内留言空间</h3>
            <p>留下称呼和邮箱以进入您的设备内留言空间。网站不会发送验证邮件，也不会上传这些信息。</p>
            <label htmlFor="blackboard-nickname">怎么称呼您？</label>
            <input id="blackboard-nickname" className="field" type="text" autoComplete="nickname" maxLength={30} placeholder="您的昵称" value={draftNickname} onChange={(event) => setDraftNickname(event.target.value)} />
            <label htmlFor="blackboard-email">邮箱地址</label>
            <input id="blackboard-email" className="field" type="email" autoComplete="email" placeholder="name@example.com" value={draftEmail} onChange={(event) => setDraftEmail(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && enterBlackboard()} />
            <button className="btn-primary" onClick={enterBlackboard}>进入小黑板</button>
          </div>
        ) : (
          <>
            <header className="blackboard-toolbar">
              <div>
                <span>当前设备中的聊天记录</span>
                <strong>{thread.nickname} · {thread.email}</strong>
              </div>
            </header>
            <p className="blackboard-demo-guide">Chenyu 在同一设备和浏览器中打开后台后，可以查看并回复这条留言。</p>
            <BlackboardMessages thread={thread} />
            <div className="blackboard-composer">
              <label htmlFor="blackboard-message">写下您的留言</label>
              <textarea id="blackboard-message" className="field" maxLength={500} placeholder="想对 Chenyu 说些什么？" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <div>
                <span>{draft.length}/500</span>
                <button className="btn-primary" onClick={sendMessage}>发送留言</button>
              </div>
            </div>
          </>
        )}
        {notice ? <p className="blackboard-notice" role="status">{notice}</p> : null}
      </div>
    </section>
  );
}

function BlackboardMessages({ thread }: { thread: BlackboardThread }) {
  return (
    <div className="blackboard-thread" aria-live="polite">
      {thread.messages.length ? thread.messages.map((item) => (
        <article className={`blackboard-message ${item.author}`} key={item.id}>
          <div>
            <strong>{item.author === 'chen' ? 'Chenyu' : thread.nickname}</strong>
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
          </div>
          <p>{item.body}</p>
        </article>
      )) : (
        <div className="blackboard-empty">
          <strong>还没有留言</strong>
          <p>在下方写下想交流的内容，开始这段私密对话。</p>
        </div>
      )}
    </div>
  );
}

function IntroPanel() {
  return (
    <section className="grid gap-4">
      <div className="grid gap-5 border border-[#d8d1cf] bg-white p-7 lg:grid-cols-[1fr_320px]">
        <div>
          <p className="mb-2 text-sm font-bold text-[#96001e]">功能介绍</p>
          <h2 className="mb-3 text-2xl font-black">从交易所披露到周报底稿</h2>
          <p className="text-[#51484b]">
            本网站用于自动抓取上交所、深交所 REITs 专栏披露信息，识别一级市场项目进度，并展示可核验、可编辑、可导出的周报简报底稿。
          </p>
        </div>
        <div className="border border-[#e0c27c] bg-[#f7f1e0] p-5">
          <strong className="text-[#96001e]">复核提示</strong>
          <p className="mt-2 text-sm text-[#51484b]">
            网站呈现内容均为 AI 自动抓取和生成。如制作标准版周报，仍需人工对照原公告及 PDF 文件进行复核。
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {['每日双次更新', '按周自动归档', '本地编辑导出'].map((item, index) => (
          <article key={item} className="border border-[#d8d1cf] bg-white p-5">
            <span className="text-sm font-black text-[#96001e]">{String(index + 1).padStart(2, '0')}</span>
            <h3 className="mt-2 text-lg font-black">{item}</h3>
          </article>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="border border-[#d8d1cf] bg-white p-6">
          <p className="mb-2 text-sm font-bold text-[#96001e]">自动简报</p>
          <h3 className="text-xl font-black">本网页安全调用 DeepSeek V4.1 Flash</h3>
        </article>
        <article className="border border-[#e7bebf] bg-[#fffafa] p-6">
          <p className="mb-2 text-sm font-bold text-[#96001e]">更新频率</p>
          <h3 className="mb-3 text-xl font-black">每日 08:30、18:30</h3>
          <p className="text-sm leading-7 text-[#51484b]">
            正式版支持管理员登录后可随时执行“抓取并生成”，即时更新当前已接入的交易所披露与简报内容。
          </p>
        </article>
      </div>
      <article className="border border-[#e0c27c] bg-[#f7f1e0] p-5">
        <p className="text-sm font-bold text-[#96001e]">使用交流</p>
        <p className="mt-2 text-sm leading-7 text-[#51484b]">
          如遇使用问题，欢迎交流：<a className="font-bold text-[#96001e]" href="mailto:fengchenyu0707@163.com">fengchenyu0707@163.com</a>
        </p>
      </article>
    </section>
  );
}

function BriefPanel(props: {
  loading: boolean;
  records: ReitsRecord[];
  filtered: ReitsRecord[];
  stats: ReturnType<typeof buildStats>;
  types: string[];
  typeFilter: string;
  exchangeFilter: string;
  localEdit: boolean;
  setTypeFilter: (value: string) => void;
  setExchangeFilter: (value: string) => void;
  setLocalEdit: (value: boolean) => void;
  visitorArchives: VisitorArchive[];
  saveVisitorArchive: () => void;
  loadVisitorArchive: (archive: VisitorArchive) => void;
  deleteVisitorArchive: (id: string) => void;
  updateLocalRecord: (id: string, patch: Partial<ReitsRecord>) => void;
  addLocalRecord: () => void;
  exportWord: () => void;
  clearLocalChanges: () => void;
  compareRecord: ReitsRecord | null;
  setCompareRecord: (record: ReitsRecord) => void;
  clearCompareRecord: () => void;
  latestRun?: ApiPayload['latestRun'];
}) {
  return (
    <section>
      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <Stat label="本期项目" value={String(props.records.length)} />
        <Stat label="上交所" value={String(props.stats.exchange['上交所'] || 0)} />
        <Stat label="深交所" value={String(props.stats.exchange['深交所'] || 0)} />
        <Stat label="需展示原文件" value={String(props.records.filter((record) => record.files.length).length)} />
      </div>

      <section className="mb-5 border border-[#d8d1cf] bg-[#f7f1e0] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black">编辑模式</h2>
            <p className="text-sm text-[#51484b]">开启后，访客只在本机新增、删除和修改简报，不影响全站内容。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => props.setLocalEdit(!props.localEdit)}>
              {props.localEdit ? '关闭编辑模式' : '开启编辑模式'}
            </button>
            <button className="btn-muted" onClick={props.addLocalRecord} disabled={!props.localEdit}>新增项目</button>
            <button className="btn-muted" onClick={props.exportWord}>导出 Word 文档</button>
            <button className="btn-muted" onClick={props.clearLocalChanges}>清除本地修改</button>
          </div>
        </div>
      </section>

      <section className="mb-5 grid gap-4 border border-[#d8d1cf] bg-white p-5 lg:grid-cols-[0.75fr_1fr]">
        <div>
          <p className="text-sm font-bold text-[#96001e]">自动更新</p>
          <h2 className="mt-1 text-xl font-black">DeepSeek Flash 服务端生成</h2>
          <p className="mt-2 text-sm leading-7 text-[#51484b]">
            每日北京时间 08:30、18:30 由 Vercel 定时任务自动更新，管理员也可在后台手动补抓。生成失败或格式不合格时保留原简报，不会用错误结果覆盖。
          </p>
        </div>
        <div className="ai-status-card">
          <span>最近一次实际运行</span>
          <strong>{props.latestRun?.started_at ? new Date(props.latestRun.started_at).toLocaleString('zh-CN') : '尚无运行记录'}</strong>
          <p>{props.latestRun?.message || '登录后台后可手动执行“抓取并生成”。'}</p>
        </div>
      </section>

      <section className="mb-5 grid gap-4 md:grid-cols-2">
        <article className="archive-card">
          <p className="text-sm font-bold text-[#96001e]">全站归档</p>
          <h2 className="mt-1 text-xl font-black">正式周报内容归档</h2>
          <p className="mt-3 text-sm leading-7 text-[#51484b]">
            全站归档保存网站数据库中的正式内容，由管理员后台或定时任务触发。服务端生成并通过格式校验的简报会进入正式内容，访客本地编辑不会影响全站归档。
          </p>
          <div className="archive-status">
            <span>当前周</span>
            <strong>{props.records.length} 个项目</strong>
            <em>周末归档后固定</em>
          </div>
        </article>
        <article className="archive-card visitor">
          <p className="text-sm font-bold text-[#96001e]">访客本地归档</p>
          <h2 className="mt-1 text-xl font-black">保存自己的编辑版本</h2>
          <p className="mt-3 text-sm leading-7 text-[#51484b]">
            访客可将当前浏览器中的简报保存为个人归档，后续在同一台电脑、同一浏览器中读取或导出 Word。该归档不上传服务器。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={props.saveVisitorArchive}>保存本周到本地归档</button>
            <button className="btn-muted" onClick={props.exportWord}>导出当前简报</button>
          </div>
          <div className="mt-4 grid gap-2">
            {props.visitorArchives.length ? props.visitorArchives.map((archive) => (
              <div className="local-archive-row" key={archive.id}>
                <button onClick={() => props.loadVisitorArchive(archive)}>
                  <strong>{dotDate(archive.weekStart)} - {dotDate(archive.weekEnd)}</strong>
                  <span>{archive.records.length} 项，保存于 {new Date(archive.savedAt).toLocaleString('zh-CN')}</span>
                </button>
                <button className="archive-delete" onClick={() => props.deleteVisitorArchive(archive.id)}>删除</button>
              </div>
            )) : <p className="text-sm text-[#695f62]">暂无访客本地归档。</p>}
          </div>
        </article>
      </section>

      <section className="mb-5 grid gap-4">
        <article className="border border-[#d8d1cf] bg-white p-5">
          <p className="text-sm font-bold text-[#96001e]">本周要点</p>
          <h2 className="mb-4 text-xl font-black">按进度类型合并展示</h2>
          <div className="grid gap-2">
            {Object.entries(props.stats.type).map(([type, count]) => (
              <button key={type} className="key-row" onClick={() => props.setTypeFilter(type)}>
                <strong>{type}</strong><span>{count}</span><em>{props.records.filter((record) => record.progressType === type).map((record) => record.title).join('、')}</em>
              </button>
            ))}
          </div>
        </article>
        <div className="grid gap-4 md:grid-cols-2">
          <Distribution title="本周项目进度" data={props.stats.type} onClick={props.setTypeFilter} />
          <Distribution title="披露来源" data={props.stats.exchange} onClick={props.setExchangeFilter} />
        </div>
        <article className="border border-[#d8d1cf] bg-white p-5">
          <p className="text-sm font-bold text-[#96001e]">官方入口</p>
          <h2 className="mb-4 text-xl font-black">交易所 REITs 专栏</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <a className="exchange-link" href="https://www.sse.com.cn/reits/info/" target="_blank" rel="noreferrer">上交所 REITs 专栏<span>项目动态与 REITs 公告</span></a>
            <a className="exchange-link alt" href="https://reits.szse.cn/projectdynamic/index.html" target="_blank" rel="noreferrer">深交所 REITs 专栏<span>项目动态与信息披露</span></a>
          </div>
        </article>
      </section>

      <section className="mb-5 grid gap-4 border border-[#d8d1cf] bg-white p-5 md:grid-cols-2">
        <Filter title="进度类型" values={props.types} active={props.typeFilter} onClick={props.setTypeFilter} />
        <Filter title="交易所" values={['全部', '上交所', '深交所']} active={props.exchangeFilter} onClick={props.setExchangeFilter} />
      </section>

      <div className="grid gap-5">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-2xl font-black">本周一级项目动态</h2>
            <span className="text-sm text-[#695f62]">共 {props.filtered.length} 项 · 发布时间由近到远</span>
          </div>
          {props.loading ? <p className="border bg-white p-6">正在读取本周数据...</p> : null}
          {!props.loading && !props.filtered.length ? (
            <div className="empty-state">
              <strong>当前筛选条件下暂无项目</strong>
              <p>可切换进度类型或交易所查看其他项目。</p>
            </div>
          ) : null}
          <div className="grid gap-4">
            {props.filtered.map((record) => (
              <div className="grid gap-3" key={record.id}>
                <ProjectCard
                  record={record}
                  localEdit={props.localEdit}
                  updateLocalRecord={props.updateLocalRecord}
                  setCompareRecord={props.setCompareRecord}
                />
                {props.compareRecord?.id === record.id ? (
                  <ComparePanel record={record} onClose={props.clearCompareRecord} />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function ProjectCard(props: {
  record: ReitsRecord;
  localEdit: boolean;
  updateLocalRecord: (id: string, patch: Partial<ReitsRecord>) => void;
  setCompareRecord: (record: ReitsRecord) => void;
}) {
  const { record } = props;
  return (
    <article className={`project-card ${record.exchange === '深交所' ? 'szse' : 'sse'}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[#695f62]">
        <span className={`badge ${record.exchange === '深交所' ? 'szse' : 'sse'}`}>{record.exchange}</span>
        <span>更新时间：{record.updateDate}</span>
        <span>项目状态：{record.status}</span>
      </div>
      {props.localEdit ? (
        <input className="field mb-3 text-xl font-black" value={record.title} onChange={(event) => props.updateLocalRecord(record.id, { title: event.target.value })} />
      ) : (
        <h3 className="mb-3 text-xl font-black">{record.title}</h3>
      )}
      {props.localEdit ? (
        <textarea className="field min-h-40" value={record.brief} onChange={(event) => props.updateLocalRecord(record.id, { brief: event.target.value })} />
      ) : (
        <>
          <p className="brief">{record.brief}</p>
          {record.note ? <p className="brief-note">补充说明：{record.note}</p> : null}
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn-muted" onClick={() => props.setCompareRecord(record)}>同屏核对</button>
        {record.files.length ? record.files.map((file) => <a key={file.url} className="file-link" href={file.url} target="_blank" rel="noreferrer">{file.label}</a>) : <span className="text-sm text-[#695f62]">申报阶段暂无需展示的原文件</span>}
      </div>
    </article>
  );
}

function AdminPanel(props: {
  adminPassword: string;
  setAdminPassword: (value: string) => void;
  adminAuthed: boolean;
  adminLogin: () => void;
  records: ReitsRecord[];
  adminSave: (record: ReitsRecord) => void;
  adminDelete: (id: string) => void;
  adminRefresh: () => void;
  adminArchive: () => void;
}) {
  return (
    <section className="grid gap-5">
      <div className="border border-[#d8d1cf] bg-white p-6">
        <h2 className="mb-3 text-2xl font-black">后台管理</h2>
        <p className="mb-4 text-[#51484b]">后台入口使用管理员密码。未登录访客不能保存、删除、抓取或归档全站内容。</p>
        <div className="flex flex-wrap gap-3">
          <input className="field max-w-sm" type="password" placeholder="管理员密码" value={props.adminPassword} onChange={(event) => props.setAdminPassword(event.target.value)} />
          <button className="btn-primary" onClick={props.adminLogin}>登录后台</button>
        </div>
      </div>
      {props.adminAuthed ? (
        <>
          <AdminBlackboardDemo />
          <div className="flex flex-wrap gap-3 border border-[#e0c27c] bg-[#f7f1e0] p-5">
            <button className="btn-primary" onClick={props.adminRefresh}>立即抓取并生成简报</button>
            <button className="btn-muted" onClick={props.adminArchive}>归档当前周</button>
          </div>
          <div className="grid gap-4">
            {props.records.map((record) => (
              <article key={record.id} className="border border-[#d8d1cf] bg-white p-5">
                <h3 className="mb-3 text-lg font-black">{record.title}</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <input className="field" defaultValue={record.title} onBlur={(event) => props.adminSave({ ...record, title: event.target.value })} />
                  <input className="field" defaultValue={record.status} onBlur={(event) => props.adminSave({ ...record, status: event.target.value })} />
                  <input className="field" defaultValue={record.progressType} onBlur={(event) => props.adminSave({ ...record, progressType: event.target.value })} />
                </div>
                <textarea className="field mt-3 min-h-32" defaultValue={record.brief} onBlur={(event) => props.adminSave({ ...record, brief: event.target.value })} />
                <button className="btn-danger mt-3" onClick={() => props.adminDelete(record.id)}>删除全站项目</button>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function AdminBlackboardDemo() {
  const [threads, setThreads] = useState<BlackboardThread[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const selected = threads.find((thread) => thread.id === selectedId) || threads[0] || null;

  useEffect(() => {
    const next = readBlackboardThreads();
    setThreads(next);
    setSelectedId((current) => current || next[0]?.id || '');
  }, []);

  function reply() {
    const body = draft.trim();
    if (!selected || !body) {
      setNotice('请先选择访客并填写回复内容。');
      return;
    }
    const now = new Date().toISOString();
    const nextThread = {
      ...selected,
      updatedAt: now,
      messages: [...selected.messages, { id: crypto.randomUUID(), author: 'chen' as const, body, createdAt: now }],
    };
    const next = threads.map((thread) => thread.id === selected.id ? nextThread : thread)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    saveBlackboardThreads(next);
    setThreads(next);
    setSelectedId(nextThread.id);
    setDraft('');
    setNotice(`已回复 ${selected.nickname}。`);
  }

  return (
    <section className="admin-blackboard">
      <header>
        <div>
          <p>小黑板留言</p>
          <h2>当前设备访客留言</h2>
        </div>
        <span>{threads.length} 位访客</span>
      </header>
      {threads.length ? (
        <div className="admin-blackboard-grid">
          <nav className="blackboard-inbox-list" aria-label="留言访客列表">
            {threads.map((thread) => (
              <button className={thread.id === selected?.id ? 'active' : ''} key={thread.id} onClick={() => setSelectedId(thread.id)}>
                <strong>{thread.nickname}</strong>
                <span>{thread.email}</span>
                <em>{thread.messages.at(-1)?.body || '尚未留言'}</em>
              </button>
            ))}
          </nav>
          {selected ? (
            <div className="admin-blackboard-conversation">
              <div className="admin-blackboard-person">
                <div><span>当前访客</span><strong>{selected.nickname}</strong></div>
                <small>{selected.email}</small>
              </div>
              <BlackboardMessages thread={selected} />
              <div className="blackboard-composer">
                <label htmlFor="admin-blackboard-reply">回复 {selected.nickname}</label>
                <textarea id="admin-blackboard-reply" className="field" maxLength={500} placeholder={`回复 ${selected.nickname}……`} value={draft} onChange={(event) => setDraft(event.target.value)} />
                <div><span>{draft.length}/500</span><button className="btn-primary" onClick={reply}>发送回复</button></div>
              </div>
              {notice ? <p className="blackboard-notice" role="status">{notice}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="blackboard-inbox-empty"><strong>暂时没有访客留言</strong><p>收到留言后，将按访客昵称显示在这里。</p></div>
      )}
    </section>
  );
}

function ComparePanel({ record, onClose }: { record: ReitsRecord; onClose: () => void }) {
  return (
    <section id={comparePanelId(record.id)} className="border border-[#d8d1cf] bg-white">
      <div className="flex items-center justify-between border-b border-[#d8d1cf] p-5">
        <div>
          <p className="text-sm font-bold text-[#96001e]">同屏核对</p>
          <h2 className="text-xl font-black">{record.title}</h2>
        </div>
        <button className="btn-muted" onClick={onClose}>关闭</button>
      </div>
      <div className="grid lg:grid-cols-[0.82fr_1fr]">
        <div className="compare-brief min-h-[520px] bg-[#f7f1e0] p-5 leading-8 text-[#334155]">
          <p className="mb-3 text-sm font-bold text-[#96001e]">简报正文</p>
          <p>{record.brief}</p>
          {record.note ? <p className="brief-note">补充说明：{record.note}</p> : null}
        </div>
        <div className="source-frame min-h-[520px] border-l border-[#d8d1cf] p-5" dangerouslySetInnerHTML={{ __html: record.sourceHtml || '<p>暂无结构化原文摘录。</p>' }} />
      </div>
    </section>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={`tab-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{children}</button>;
}

function comparePanelId(id: string) {
  return `compare-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="border border-[#d8d1cf] bg-white p-5"><span className="text-sm text-[#695f62]">{label}</span><strong className="block text-3xl">{value}</strong></article>;
}

function Distribution({ title, data, onClick }: { title: string; data: Record<string, number>; onClick: (key: string) => void }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <article className="border border-[#d8d1cf] bg-white p-5">
      <p className="text-sm font-bold text-[#96001e]">分布</p>
      <h2 className="mb-4 text-xl font-black">{title}</h2>
      <div className="grid gap-3">
        {Object.entries(data).map(([key, count]) => (
          <button key={key} className="text-left" aria-label={`筛选${title}：${key}，${count}项`} onClick={() => onClick(key)}>
            <span className="flex justify-between font-bold"><b>{key}</b><em>{count}项</em></span>
            <i className="mt-2 block h-2 bg-[#f7f1e0]"><span className="block h-2 bg-[#96001e]" style={{ width: `${(count / max) * 100}%` }} /></i>
          </button>
        ))}
      </div>
    </article>
  );
}

function Filter({ title, values, active, onClick }: { title: string; values: string[]; active: string; onClick: (value: string) => void }) {
  return <div><strong className="mb-2 block">{title}</strong><div className="flex flex-wrap gap-2">{values.map((value) => <button key={value} className={active === value ? 'filter active' : 'filter'} onClick={() => onClick(value)}>{value}</button>)}</div></div>;
}

function buildStats(records: ReitsRecord[]) {
  return {
    type: countBy(records, (record) => record.progressType),
    exchange: countBy(records, (record) => record.exchange),
  };
}

function countBy(records: ReitsRecord[], pick: (record: ReitsRecord) => string) {
  return records.reduce<Record<string, number>>((acc, record) => {
    const key = pick(record);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function dotDate(value: string) {
  return value.replaceAll('-', '.');
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readBlackboardThreads(): BlackboardThread[] {
  const saved = localStorage.getItem(blackboardKey);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }

  try {
    const legacy = JSON.parse(localStorage.getItem('reits-blackboard-demo-v1') || '{}') as {
      email?: string;
      nickname?: string;
      messages?: BlackboardMessage[];
    };
    if (!legacy.email) return [];
    const messages = Array.isArray(legacy.messages) ? legacy.messages : [];
    const createdAt = messages[0]?.createdAt || new Date().toISOString();
    const thread: BlackboardThread = {
      id: crypto.randomUUID(),
      nickname: legacy.nickname || '访客',
      email: legacy.email,
      messages,
      createdAt,
      updatedAt: messages.at(-1)?.createdAt || createdAt,
    };
    localStorage.setItem(blackboardKey, JSON.stringify([thread]));
    return [thread];
  } catch {
    return [];
  }
}

function saveBlackboardThreads(threads: BlackboardThread[]) {
  localStorage.setItem(blackboardKey, JSON.stringify(threads));
  window.dispatchEvent(new Event(blackboardUpdateEvent));
}

function readVisitorArchives() {
  try {
    const parsed = JSON.parse(localStorage.getItem(visitorArchiveKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
