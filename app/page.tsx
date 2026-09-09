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

const localKey = 'reits-live-visitor-edits-v1';

export default function Home() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [records, setRecords] = useState<ReitsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'intro' | 'briefs' | 'admin'>('briefs');
  const [typeFilter, setTypeFilter] = useState('全部');
  const [exchangeFilter, setExchangeFilter] = useState('全部');
  const [compareRecord, setCompareRecord] = useState<ReitsRecord | null>(null);
  const [localEdit, setLocalEdit] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthed, setAdminAuthed] = useState(false);

  useEffect(() => {
    loadData();
    const saved = sessionStorage.getItem('reits-admin-password');
    if (saved) {
      setAdminPassword(saved);
      setAdminAuthed(true);
    }
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
    setMessage('正在抓取交易所数据...');
    const response = await fetch('/api/admin/refresh', { method: 'POST', headers: adminHeaders() });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? `抓取完成：${data.message || '已刷新。'}` : '抓取失败，请检查管理员密码或稍后重试。');
    if (response.ok) await loadData();
  }

  async function adminArchive() {
    const response = await fetch('/api/admin/archive', { method: 'POST', headers: adminHeaders() });
    const data = await response.json().catch(() => ({}));
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
        <nav className="mb-6 inline-flex border border-[#d8d1cf] bg-white">
          <TabButton active={activeTab === 'intro'} onClick={() => setActiveTab('intro')}>功能介绍</TabButton>
          <TabButton active={activeTab === 'briefs'} onClick={() => setActiveTab('briefs')}>简报速递</TabButton>
          <TabButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')}>后台管理</TabButton>
        </nav>

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
            updateLocalRecord={updateLocalRecord}
            addLocalRecord={addLocalRecord}
            exportWord={exportWord}
            setCompareRecord={setCompareRecord}
            latestRun={payload?.latestRun}
          />
        ) : null}
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
        {compareRecord ? <ComparePanel record={compareRecord} onClose={() => setCompareRecord(null)} /> : null}
      </div>
    </main>
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
      <div className="grid gap-3 md:grid-cols-4">
        {['每日自动抓取', '按周自动归档', '后台密码管理', '本地编辑导出'].map((item, index) => (
          <article key={item} className="border border-[#d8d1cf] bg-white p-5">
            <span className="text-sm font-black text-[#96001e]">{String(index + 1).padStart(2, '0')}</span>
            <h3 className="mt-2 text-lg font-black">{item}</h3>
          </article>
        ))}
      </div>
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
  updateLocalRecord: (id: string, patch: Partial<ReitsRecord>) => void;
  addLocalRecord: () => void;
  exportWord: () => void;
  setCompareRecord: (record: ReitsRecord) => void;
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
            <button className="btn-muted" onClick={() => localStorage.removeItem(localKey)}>清除本地修改</button>
          </div>
        </div>
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-[1.3fr_0.8fr_0.8fr]">
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
        <Distribution title="本周项目进度" data={props.stats.type} onClick={props.setTypeFilter} />
        <Distribution title="披露来源" data={props.stats.exchange} onClick={props.setExchangeFilter} />
        <article className="border border-[#d8d1cf] bg-white p-5 lg:col-span-3">
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-2xl font-black">本周一级项目动态</h2>
            <span className="text-sm text-[#695f62]">发布时间由近到远</span>
          </div>
          {props.loading ? <p className="border bg-white p-6">正在读取本周数据...</p> : null}
          <div className="grid gap-4">
            {props.filtered.map((record) => (
              <ProjectCard
                key={record.id}
                record={record}
                localEdit={props.localEdit}
                updateLocalRecord={props.updateLocalRecord}
                setCompareRecord={props.setCompareRecord}
              />
            ))}
          </div>
        </section>
        <aside className="grid content-start gap-4">
          <SideCard title="数据口径与核验方式">
            本页按访问日期读取本周一至当天的项目。简报仅引用交易所项目动态、招募说明书、反馈意见、问询函及回复文件中可核验的信息。
          </SideCard>
          <SideCard title="自动更新状态">
            {props.latestRun?.started_at ? `最近抓取：${new Date(props.latestRun.started_at).toLocaleString('zh-CN')}。${props.latestRun.message || ''}` : '首次访问时会尝试抓取交易所数据。'}
          </SideCard>
          <SideCard title="历史归档">
            上线后每周结束自动保存当周内容，不回补网站完成前的历史周报。
          </SideCard>
        </aside>
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
        <p className={record.note ? 'brief with-note' : 'brief'}>{record.brief}</p>
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
          <div className="flex flex-wrap gap-3 border border-[#e0c27c] bg-[#f7f1e0] p-5">
            <button className="btn-primary" onClick={props.adminRefresh}>立即抓取交易所数据</button>
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

function ComparePanel({ record, onClose }: { record: ReitsRecord; onClose: () => void }) {
  return (
    <section className="mt-8 border border-[#d8d1cf] bg-white">
      <div className="flex items-center justify-between border-b border-[#d8d1cf] p-5">
        <div>
          <p className="text-sm font-bold text-[#96001e]">同屏核对</p>
          <h2 className="text-xl font-black">{record.title}</h2>
        </div>
        <button className="btn-muted" onClick={onClose}>关闭</button>
      </div>
      <div className="grid lg:grid-cols-[0.82fr_1fr]">
        <textarea className="min-h-[520px] border-0 bg-[#f7f1e0] p-5 leading-8 text-[#334155]" defaultValue={record.brief} />
        <div className="source-frame min-h-[520px] border-l border-[#d8d1cf] p-5" dangerouslySetInnerHTML={{ __html: record.sourceHtml || '<p>暂无结构化原文摘录。</p>' }} />
      </div>
    </section>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={`min-h-12 min-w-40 px-7 text-lg font-black ${active ? 'bg-[#96001e] text-white' : 'bg-white'}`} onClick={onClick}>{children}</button>;
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
          <button key={key} className="text-left" onClick={() => onClick(key)}>
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

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border border-[#d8d1cf] bg-white p-5"><h2 className="mb-3 text-xl font-black">{title}</h2><p className="text-[#51484b]">{children}</p></section>;
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
