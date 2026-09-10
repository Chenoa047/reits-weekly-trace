import { env } from 'cloudflare:workers';
import { generateDeepSeekBrief, sourceSignature } from '@/lib/deepseek';

export type ReitsFile = {
  label: string;
  url: string;
  kind: string;
};

export type ReitsRecord = {
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
  isArchived?: boolean;
};

type D1 = D1Database;

const SSE_QUERY = 'https://query.sse.com.cn/commonSoaQuery.do';
const SSE_REFERER = 'https://www.sse.com.cn/reits/info/';
const SSE_FILE_BASE = 'https://static.sse.com.cn/bond';

export const seedRecords: ReitsRecord[] = [
  {
    id: 'sse-2b6853bdbec648e0821425c40f6d5b45-2026-09-07',
    exchange: '上交所',
    fullName: '嘉实京东仓储物流封闭式基础设施证券投资基金',
    shortName: '嘉实京东仓储物流REIT',
    title: '嘉实京东仓储物流REIT扩募获上交所反馈意见',
    status: '已反馈',
    progressType: '反馈/问询',
    updateDate: '2026-09-07',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-09',
    originator: '北京京东耀弘管理咨询有限公司',
    brief:
      '9月7日，上交所网站显示，嘉实京东仓储物流REIT项目状态更新为“已反馈”。上交所披露的受理反馈意见主要围绕业务参与人资质及履职能力、不动产合规情况、项目经营与财务情况、资产评估与估值合理性、基金运作与治理等方面展开，要求管理人进一步补充说明或充分披露。其余还包括扩募条件、共管账户、基金收益水平、信息披露和资产投保情况等其他反馈意见。招募说明书草案显示，本次扩募原始权益人为北京京东耀弘管理咨询有限公司，拟购入资产为京东西北电子商务营业中心（京东二期）项目和京东安徽电子商务产业园二期项目，分别位于陕西省西安市灞桥区和安徽省合肥市长丰县，拟购入不动产资产评估值合计10.34亿元。',
    files: [
      {
        label: '受理反馈意见原文',
        kind: '反馈意见',
        url: 'https://static.sse.com.cn/bond/bridge2/disclosure/announcement/c/202609/2b6853_20260907_X0EZ.pdf',
      },
      {
        label: '招募说明书草案原文',
        kind: '招募说明书',
        url: 'https://static.sse.com.cn/bond/bridge2/disclosure/announcement/c/202607/2b6853_20260724_91UB.pdf',
      },
    ],
    sourceUrl: SSE_REFERER,
    sourceHtml:
      '<h3>对应原文摘录</h3><p><span class="page-ref">项目动态页</span><mark>项目状态更新为“已反馈”</mark>。来源：上交所 REITs 项目动态详情页。</p><p><span class="page-ref">反馈意见第1-8页</span>上交所《受理反馈意见》列明的主要问题包括：<mark>业务参与人资质及履职能力、不动产合规情况、项目经营与财务情况、资产评估与估值合理性、基金运作与治理</mark>。</p><p><span class="page-ref">反馈意见第9-10页</span>《受理反馈意见》“六、其他反馈问题”包括：<mark>扩募条件、共管账户、基金收益水平、信息披露、资产投保情况</mark>。</p><p><span class="page-ref">招募说明书第4页、第30-31页</span>招募说明书草案显示，<mark>原始权益人为北京京东耀弘管理咨询有限公司</mark>，拟购入项目为<mark>京东西北电子商务营业中心（京东二期）项目、京东安徽电子商务产业园二期项目</mark>，项目所在地分别为<mark>陕西省西安市灞桥区、安徽省合肥市长丰县</mark>。</p><p><span class="page-ref">招募说明书第35页</span>最新发布的受理反馈意见未披露调整后估值，估值数据沿用招募说明书草案“不动产项目资产评估以及现金流预测表”：西安项目估值规模为4.63亿元，合肥项目估值规模为5.71亿元，<mark>拟购入不动产资产评估值合计10.34亿元</mark>。</p>',
  },
  {
    id: 'szse-huaxia-zhonghai-2026-09-07',
    exchange: '深交所',
    fullName: '华夏中海封闭式商业不动产证券投资基金',
    shortName: '华夏中海商业不动产REIT',
    title: '华夏中海商业不动产REIT申报至深交所',
    status: '已申报',
    progressType: '申报',
    updateDate: '2026-09-07',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-09',
    originator: '中海企业发展集团有限公司',
    brief:
      '9月7日，深交所网站显示，华夏中海商业不动产REIT审核状态为“已申报”。项目原始权益人为中海企业发展集团有限公司。深交所项目详情页显示，该项目当前仍处于申报阶段，披露材料、问询与回复、上市委会议结论、终止审核通知、注册结果通知及现金重组报告书附件均为空。因此，本简报仅依据项目动态页列示项目名称、更新时间、审核状态和原始权益人，不对底层资产名称、区位、面积、估值、运营情况及发行安排作进一步描述。',
    note: '申报阶段暂无招募说明书等原文件，后半段为依据项目动态页附件状态形成的补充说明。',
    files: [],
    sourceUrl: 'https://reits.szse.cn/projectdynamic/index.html',
    sourceHtml:
      '<h3>对应原文摘录</h3><p><span class="page-ref">项目动态页</span>深交所 REITs 项目动态详情页显示，华夏中海封闭式商业不动产证券投资基金<mark>审核状态为“已申报”</mark>，更新时间为<mark>2026-09-07</mark>。</p><p><span class="page-ref">项目动态页</span>项目动态详情页显示，<mark>原始权益人为中海企业发展集团有限公司</mark>。</p><p>补充说明：该项目详情页披露材料、问询与回复、上市委会议结论、终止审核通知、注册结果通知及现金重组报告书附件均为空，因此底层资产和发行安排未在本页进一步展开。</p>',
  },
];

export function todayChina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function weekRangeFor(dateText = todayChina()) {
  const [year, month, dayOfMonth] = dateText.split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const day = current.getUTCDay() || 7;
  const start = new Date(current);
  start.setUTCDate(current.getUTCDate() - day + 1);
  return {
    start: formatDateParts(start),
    end: dateText,
  };
}

export function displayDate(dateText: string) {
  const [, month, day] = dateText.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function briefName(fullName: string) {
  return fullName
    .replace('封闭式基础设施证券投资基金', 'REIT')
    .replace('封闭式商业不动产证券投资基金', 'REIT')
    .replace('证券投资基金', 'REIT');
}

export function assertAdmin(request: Request) {
  const password = request.headers.get('x-admin-password') || '';
  const expected = env.ADMIN_PASSWORD || '';
  if (!expected || password !== expected) {
    return new Response(JSON.stringify({ message: '管理员密码错误或尚未配置。' }), {
      status: 401,
      headers: jsonHeaders(),
    });
  }
  return null;
}

export async function listCurrentWeek(db: D1, dateText = todayChina()) {
  const { start, end } = weekRangeFor(dateText);
  const rows = await db
    .prepare(
      `SELECT * FROM projects
       WHERE update_date >= ? AND update_date <= ? AND is_archived = 0
       ORDER BY update_date DESC, updated_at DESC`,
    )
    .bind(start, end)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));
  return {
    range: { start, end },
    records: rows.results.length ? rows.results.map(rowToRecord) : seedRecordsForRange(start, end),
  };
}

export async function latestRun(db: D1) {
  const row = await db
    .prepare('SELECT * FROM fetch_runs ORDER BY started_at DESC LIMIT 1')
    .first<Record<string, unknown>>()
    .catch(() => null);
  return row || null;
}

export async function upsertRecord(db: D1, record: ReitsRecord) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO projects
       (id, exchange, full_name, short_name, title, status, progress_type, update_date, week_start, week_end, originator, brief, note, files_json, source_html, source_url, raw_json, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
       exchange = excluded.exchange,
       full_name = excluded.full_name,
       short_name = excluded.short_name,
       title = excluded.title,
       status = excluded.status,
       progress_type = excluded.progress_type,
       update_date = excluded.update_date,
       week_start = excluded.week_start,
       week_end = excluded.week_end,
       originator = excluded.originator,
       brief = excluded.brief,
       note = excluded.note,
       files_json = excluded.files_json,
       source_html = excluded.source_html,
       source_url = excluded.source_url,
       raw_json = excluded.raw_json,
       updated_at = excluded.updated_at`,
    )
    .bind(
      record.id,
      record.exchange,
      record.fullName,
      record.shortName,
      record.title,
      record.status,
      record.progressType,
      record.updateDate,
      record.weekStart,
      record.weekEnd,
      record.originator || null,
      record.brief,
      record.note || null,
      JSON.stringify(record.files),
      record.sourceHtml,
      record.sourceUrl || null,
      JSON.stringify(record),
      now,
      now,
    )
    .run();
}

export async function saveAdminRecord(db: D1, record: ReitsRecord) {
  await upsertRecord(db, record);
}

export async function deleteRecord(db: D1, id: string) {
  await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
}

export async function refreshWeek(
  db: D1,
  dateText = todayChina(),
  options: { generateBriefs?: boolean; forceGenerate?: boolean } = {},
) {
  const { start, end } = weekRangeFor(dateText);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db
    .prepare('INSERT INTO fetch_runs (id, started_at, status, week_start, week_end, message) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(runId, startedAt, 'running', start, end, '开始抓取交易所数据。')
    .run();

  let message = '';
  let sseCount = 0;
  let szseCount = 0;
  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const sseRecords = await fetchSseRecords(start, end);
    sseCount = sseRecords.length;
    for (const record of sseRecords) {
      const existing = await findRecord(db, record.id);
      const sourceChanged = !existing || sourceSignature(existing) !== sourceSignature(record);
      const shouldGenerate = Boolean(options.generateBriefs && (options.forceGenerate || sourceChanged));
      if (shouldGenerate) {
        try {
          const generated = await generateDeepSeekBrief(record);
          record.brief = generated.brief;
          generatedCount += 1;
          inputTokens += generated.inputTokens;
          outputTokens += generated.outputTokens;
        } catch {
          failedCount += 1;
          if (existing) {
            record.brief = existing.brief;
            record.note = existing.note;
          }
        }
      } else if (options.generateBriefs) {
        skippedCount += 1;
        if (existing) {
          record.brief = existing.brief;
          record.note = existing.note;
        }
      }
      await upsertRecord(db, record);
    }
    const aiMessage = options.generateBriefs
      ? `；DeepSeek Flash 生成 ${generatedCount} 条、跳过 ${skippedCount} 条、失败 ${failedCount} 条，输入 ${inputTokens} tokens、输出 ${outputTokens} tokens`
      : '';
    message = `上交所抓取 ${sseCount} 条${aiMessage}；深交所接口待维护，保留后台编辑入口。`;
    await db
      .prepare(
        'UPDATE fetch_runs SET finished_at = ?, status = ?, sse_count = ?, szse_count = ?, message = ? WHERE id = ?',
      )
      .bind(new Date().toISOString(), 'ok', sseCount, szseCount, message, runId)
      .run();
  } catch (error) {
    message = error instanceof Error ? error.message : '抓取失败';
    await db
      .prepare(
        'UPDATE fetch_runs SET finished_at = ?, status = ?, sse_count = ?, szse_count = ?, message = ? WHERE id = ?',
      )
      .bind(new Date().toISOString(), 'failed', sseCount, szseCount, message, runId)
      .run();
  }
  return {
    runId,
    start,
    end,
    sseCount,
    szseCount,
    generatedCount,
    skippedCount,
    failedCount,
    inputTokens,
    outputTokens,
    message,
  };
}

async function findRecord(db: D1, id: string) {
  const row = await db
    .prepare('SELECT * FROM projects WHERE id = ? LIMIT 1')
    .bind(id)
    .first<Record<string, unknown>>()
    .catch(() => null);
  return row ? rowToRecord(row) : null;
}

export async function archiveCurrentWeek(db: D1, dateText = todayChina()) {
  const { range, records } = await listCurrentWeek(db, dateText);
  const id = `${range.start}_${range.end}`;
  await db
    .prepare(
      `INSERT INTO weekly_archives (id, week_start, week_end, archived_at, snapshot_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET archived_at = excluded.archived_at, snapshot_json = excluded.snapshot_json`,
    )
    .bind(id, range.start, range.end, new Date().toISOString(), JSON.stringify(records))
    .run();
  await db.prepare('UPDATE projects SET is_archived = 1 WHERE week_start = ?').bind(range.start).run();
  return { id, count: records.length };
}

async function fetchSseRecords(start: string, end: string): Promise<ReitsRecord[]> {
  const url = `${SSE_QUERY}?isPagination=true&bond_type=4&sqlId=ZQ_XMLB&pageHelp.pageSize=50&pageHelp.cacheSize=1&pageHelp.pageNo=1&pageHelp.beginPage=1`;
  const data = await fetchJson<{ result?: SseProject[] }>(url, SSE_REFERER);
  const projects = (data.result || []).filter((item) => item.PUBLISH_DATE >= start && item.PUBLISH_DATE <= end);
  return Promise.all(projects.map((project) => mapSseProject(project, start, end)));
}

async function mapSseProject(project: SseProject, weekStart: string, weekEnd: string): Promise<ReitsRecord> {
  const files = await fetchSseFiles(project.BOND_NUM).catch(() => []);
  const status = sseStatus(project);
  const progressType = inferProgress(status, files);
  const shortName = briefName(project.AUDIT_NAME);
  const title = titleFor(shortName, progressType, '上交所');
  const feedbackFiles = files.filter((file) => file.kind !== '招募说明书');
  const prospectus = files.find((file) => file.kind === '招募说明书');
  return {
    id: `sse-${project.BOND_NUM}-${project.PUBLISH_DATE}`,
    exchange: '上交所',
    fullName: project.AUDIT_NAME,
    shortName,
    title,
    status,
    progressType,
    updateDate: project.PUBLISH_DATE,
    weekStart,
    weekEnd,
    originator: clean(project.FULL_NAME),
    brief: buildSseBrief(project, progressType, feedbackFiles, prospectus),
    files,
    sourceUrl: `${SSE_REFERER}index_detail.shtml?audit_id=${project.BOND_NUM}`,
    sourceHtml: buildSseSourceHtml(project, status, feedbackFiles, prospectus),
  };
}

async function fetchSseFiles(auditId: string): Promise<ReitsFile[]> {
  const url = `${SSE_QUERY}?isPagination=false&audit_id=${encodeURIComponent(auditId)}&sqlId=ZQ_GGJG`;
  const data = await fetchJson<{ result?: SseFile[] }>(url, SSE_REFERER);
  return (data.result || []).map((file) => ({
    label: labelForFile(file.FILE_TITLE),
    kind: kindForFile(file.FILE_TITLE),
    url: `${SSE_FILE_BASE}${file.FILE_PATH}`,
  }));
}

async function fetchJson<T>(url: string, referer: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      referer,
      'user-agent': 'Mozilla/5.0 REITs weekly crawler',
    },
  });
  if (!response.ok) throw new Error(`交易所接口返回 ${response.status}`);
  return (await response.json()) as T;
}

function buildSseBrief(project: SseProject, progressType: string, feedbackFiles: ReitsFile[], prospectus?: ReitsFile) {
  const date = displayDate(project.PUBLISH_DATE);
  const shortName = briefName(project.AUDIT_NAME);
  const originator = clean(project.FULL_NAME);
  if (progressType === '反馈/问询') {
    const fileText = feedbackFiles.length ? `，并披露${feedbackFiles.map((file) => `《${file.label}》`).join('、')}` : '';
    return `${date}，上交所网站显示，${shortName}项目状态更新为“${sseStatus(project)}”${fileText}。由于当前自动简报生成接口尚未接入 PDF 正文解析，本条先依据交易所项目动态页和文件清单形成底稿：项目原始权益人为${originator}，项目状态、更新时间和原文件链接均来自上交所项目详情页。待接入简报生成接口后，系统将进一步读取反馈意见正文，按监管关注事项、其他反馈意见及项目背景形成完整周报简报。`;
  }
  if (progressType === '受理') {
    return `${date}，上交所网站显示，${shortName}项目状态为“已受理”。项目原始权益人为${originator}。${prospectus ? `网站已披露${prospectus.label}，正式简报将以最新招募说明书原文为基础提取底层资产、区位、面积、估值及发行安排。` : '项目详情页暂未抓取到招募说明书文件，底层资产等信息不作补充。'}`;
  }
  return `${date}，上交所网站显示，${shortName}项目状态为“${sseStatus(project)}”。项目原始权益人为${originator}。本条依据交易所项目动态页自动生成，文件未披露或尚未完成 PDF 解析的信息不作补充。`;
}

function buildSseSourceHtml(project: SseProject, status: string, files: ReitsFile[], prospectus?: ReitsFile) {
  const fileList = [...files, ...(prospectus ? [prospectus] : [])]
    .map((file) => `<mark>${escapeHtml(file.label)}</mark>`)
    .join('、');
  return `<h3>对应原文摘录</h3><p><span class="page-ref">项目动态页</span>${escapeHtml(project.AUDIT_NAME)}<mark>项目状态为“${status}”</mark>，更新时间为<mark>${project.PUBLISH_DATE}</mark>。</p><p><span class="page-ref">项目动态页</span>项目原始权益人为<mark>${escapeHtml(clean(project.FULL_NAME))}</mark>。</p><p><span class="page-ref">附件列表</span>${fileList || '项目详情页暂未抓取到附件。'}</p>`;
}

function rowToRecord(row: Record<string, unknown>): ReitsRecord {
  return {
    id: String(row.id),
    exchange: row.exchange as '上交所' | '深交所',
    fullName: String(row.full_name),
    shortName: String(row.short_name),
    title: String(row.title),
    status: String(row.status),
    progressType: String(row.progress_type),
    updateDate: String(row.update_date),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    originator: row.originator ? String(row.originator) : undefined,
    brief: String(row.brief),
    note: row.note ? String(row.note) : undefined,
    files: JSON.parse(String(row.files_json || '[]')),
    sourceHtml: String(row.source_html || ''),
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    isArchived: Boolean(row.is_archived),
  };
}

function seedRecordsForRange(start: string, end: string) {
  return seedRecords
    .filter((record) => record.updateDate >= start && record.updateDate <= end)
    .map((record) => ({ ...record, weekStart: start, weekEnd: end }));
}

function inferProgress(status: string, files: ReitsFile[]) {
  const hasReply = files.some((file) => /回复|答复/.test(file.label));
  if (status === '已反馈') return hasReply ? '回复反馈' : '反馈/问询';
  if (status === '已受理') return '受理';
  if (status === '已申报') return '申报';
  if (status === '注册生效') return '注册生效';
  return status;
}

function titleFor(shortName: string, progressType: string, exchange: string) {
  if (progressType === '反馈/问询') return `${shortName}获${exchange}反馈意见`;
  if (progressType === '回复反馈') return `${shortName}回复反馈`;
  if (progressType === '受理') return `${shortName}获受理`;
  if (progressType === '申报') return `${shortName}申报至${exchange}`;
  if (progressType === '注册生效') return `${shortName}注册生效`;
  return `${shortName}${progressType}`;
}

function labelForFile(title: string) {
  if (/招募说明书/.test(title)) return '招募说明书草案原文';
  if (/反馈意见/.test(title)) return /答复|回复/.test(title) ? '反馈回复原文' : '受理反馈意见原文';
  return title;
}

function kindForFile(title: string) {
  if (/招募说明书/.test(title)) return '招募说明书';
  if (/反馈意见/.test(title)) return /答复|回复/.test(title) ? '回复反馈' : '反馈意见';
  return '原文件';
}

function sseStatus(project: SseProject) {
  const map: Record<string, string> = {
    '0': '已申报',
    '1': '已受理',
    '2': '已反馈',
    '4': '通过',
    '5': '未通过',
    '8': '终止',
    '10': '已回复交易所意见',
    '11': '提交注册',
    '12': '注册生效',
  };
  return map[project.AUDIT_STATUS] || '-';
}

function clean(value: string) {
  return value.replace(/\s+/g, '').replace(/,+$/g, '') || '-';
}

function formatChinaDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatDateParts(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function jsonHeaders() {
  return { 'content-type': 'application/json; charset=utf-8' };
}

type SseProject = {
  AUDIT_NAME: string;
  AUDIT_STATUS: string;
  BOND_NUM: string;
  FULL_NAME: string;
  PUBLISH_DATE: string;
};

type SseFile = {
  FILE_TITLE: string;
  FILE_PATH: string;
};
