import type { AppDb } from '@/db';
import { generateDeepSeekBrief, sourceSignature } from '@/lib/deepseek';
import { addDocumentExcerpts } from '@/lib/pdf-text';
import {
  announcementStage,
  classifyDocument,
  documentLabel,
  inferProjectStage,
  missingRequiredMaterial,
  selectStageFiles,
  type OfferingType,
  type ReitsSourceFile,
} from '@/lib/reits-rules';

export type ReitsFile = ReitsSourceFile;

export type ReitsRecord = {
  id: string;
  exchange: '上交所' | '深交所';
  fullName: string;
  shortName: string;
  title: string;
  status: string;
  progressType: string;
  offeringType: OfferingType;
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

type D1 = AppDb;

const SSE_QUERY_ORIGINS = ['https://query.sse.com.cn', 'http://query.sse.com.cn'] as const;
const SSE_REFERER = 'https://www.sse.com.cn/reits/info/';
const SSE_BULLETIN_REFERER = 'https://www.sse.com.cn/reits/announcements/';
const SSE_FILE_BASE = 'https://static.sse.com.cn/bond';
const SSE_ANNOUNCEMENT_BASE = 'https://www.sse.com.cn';
const SZSE_ORIGINS = ['https://reits.szse.cn', 'http://reits.szse.cn'] as const;
const SZSE_FILE_BASE = 'https://reportdocs.static.szse.cn';
const SZSE_ANNOUNCEMENT_BASE = 'https://disc.static.szse.cn/download';

export const seedRecords: ReitsRecord[] = [
  {
    id: 'szse-5000079-2026-09-10',
    exchange: '深交所',
    fullName: '华安晶澳科技新能源封闭式基础设施证券投资基金',
    shortName: '华安晶澳科技新能源REIT',
    title: '华安晶澳科技新能源REIT申报至深交所',
    status: '已申报',
    progressType: '申报',
    offeringType: '首发',
    updateDate: '2026-09-10',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-10',
    originator: '晶澳太阳能投资（中国）有限公司;朝阳龙盛太阳能发电有限公司',
    brief:
      '9月10日，深交所网站显示，华安晶澳科技新能源REIT项目状态为“已申报”，原始权益人为晶澳太阳能投资（中国）有限公司、朝阳龙盛太阳能发电有限公司。',
    note: '项目详情页暂未披露招募说明书等附件，正式简报不补写底层资产、估值及发行安排。',
    files: [],
    sourceUrl:
      'https://reits.szse.cn/projectdynamic/detail/index.html?id=5000079',
    sourceHtml:
      '<h3>内容溯源</h3><p><span class="page-ref">项目动态页</span>深交所 REITs 项目动态详情页显示，华安晶澳科技新能源封闭式基础设施证券投资基金<mark>项目状态为“已申报”</mark>，更新时间为<mark>2026-09-10</mark>，原始权益人为<mark>晶澳太阳能投资（中国）有限公司、朝阳龙盛太阳能发电有限公司</mark>。</p>',
  },
  {
    id: 'sse-894cbcc4623047c385444030dd83f921-2026-09-10',
    exchange: '上交所',
    fullName: '国泰海通上实租赁住房封闭式基础设施证券投资基金',
    shortName: '国泰海通上实租赁住房REIT',
    title: '国泰海通上实租赁住房REIT申报至上交所',
    status: '已申报',
    progressType: '申报',
    offeringType: '首发',
    updateDate: '2026-09-10',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-10',
    originator: '上实城开（上海）房屋租赁有限公司',
    brief:
      '9月10日，上交所网站显示，国泰海通上实租赁住房REIT项目状态为“已申报”，原始权益人为上实城开（上海）房屋租赁有限公司。',
    note: '项目详情页暂未披露招募说明书等附件，正式简报不补写底层资产、估值及发行安排。',
    files: [],
    sourceUrl:
      'https://www.sse.com.cn/reits/info/index_detail.shtml?audit_id=894cbcc4623047c385444030dd83f921',
    sourceHtml:
      '<h3>内容溯源</h3><p><span class="page-ref">项目动态页</span>上交所 REITs 项目动态详情页显示，国泰海通上实租赁住房封闭式基础设施证券投资基金<mark>项目状态为“已申报”</mark>，更新时间为<mark>2026-09-10</mark>，原始权益人为<mark>上实城开（上海）房屋租赁有限公司</mark>。</p>',
  },
  {
    id: 'sse-2b6853bdbec648e0821425c40f6d5b45-2026-09-07',
    exchange: '上交所',
    fullName: '嘉实京东仓储物流封闭式基础设施证券投资基金',
    shortName: '嘉实京东仓储物流REIT',
    title: '嘉实京东仓储物流REIT扩募获上交所反馈意见',
    status: '已反馈',
    progressType: '反馈/问询',
    offeringType: '扩募',
    updateDate: '2026-09-07',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-09',
    originator: '北京京东耀弘管理咨询有限公司',
    brief:
      '9月7日，上交所网站显示，嘉实京东仓储物流REIT扩募项目状态更新为“已反馈”。上交所披露的受理反馈意见主要围绕业务参与人资质及履职能力、不动产合规情况、项目经营与财务情况、资产评估与估值合理性、基金运作与治理等方面展开，要求管理人进一步补充说明或充分披露；其他反馈包括扩募条件、共管账户、基金收益水平、信息披露和资产投保情况。',
    files: [
      {
        label: '受理反馈意见原文',
        kind: '反馈意见',
        originalTitle:
          '关于嘉实京东仓储物流封闭式基础设施证券投资基金产品变更暨扩募份额上市申请受理反馈意见',
        publishedAt: '2026-09-07',
        section: '反馈意见及回复',
        issuerRole: '交易所',
        url: 'https://static.sse.com.cn/bond/bridge2/disclosure/announcement/c/202609/2b6853_20260907_X0EZ.pdf',
      },
    ],
    sourceUrl: SSE_REFERER,
    sourceHtml:
      '<h3>内容溯源</h3><p><span class="page-ref">项目动态页</span><mark>项目状态更新为“已反馈”</mark>。来源：上交所 REITs 项目动态详情页。</p><p><span class="page-ref">反馈意见第1-8页</span>上交所《受理反馈意见》列明的主要问题包括：<mark>业务参与人资质及履职能力、不动产合规情况、项目经营与财务情况、资产评估与估值合理性、基金运作与治理</mark>。</p><p><span class="page-ref">反馈意见第9-10页</span>《受理反馈意见》“六、其他反馈问题”包括：<mark>扩募条件、共管账户、基金收益水平、信息披露、资产投保情况</mark>。</p>',
  },
  {
    id: 'szse-huaxia-zhonghai-2026-09-07',
    exchange: '深交所',
    fullName: '华夏中海封闭式商业不动产证券投资基金',
    shortName: '华夏中海商业不动产REIT',
    title: '华夏中海商业不动产REIT申报至深交所',
    status: '已申报',
    progressType: '申报',
    offeringType: '首发',
    updateDate: '2026-09-07',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-09',
    originator: '中海企业发展集团有限公司',
    brief:
      '9月7日，深交所网站显示，华夏中海商业不动产REIT审核状态为“已申报”，项目原始权益人为中海企业发展集团有限公司。',
    note: '项目详情页暂未披露招募说明书等附件，正式简报不补写底层资产、估值及发行安排。',
    files: [],
    sourceUrl: 'https://reits.szse.cn/projectdynamic/index.html',
    sourceHtml:
      '<h3>内容溯源</h3><p><span class="page-ref">项目动态页</span>深交所 REITs 项目动态详情页显示，华夏中海封闭式商业不动产证券投资基金<mark>审核状态为“已申报”</mark>，更新时间为<mark>2026-09-07</mark>，原始权益人为<mark>中海企业发展集团有限公司</mark>。</p>',
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

export function demoCurrentWeek(dateText = todayChina()) {
  const range = weekRangeFor(dateText);
  return {
    range,
    records: seedRecordsForRange(range.start, range.end),
  };
}

export function briefName(fullName: string) {
  return fullName
    .replace('封闭式基础设施证券投资基金', 'REIT')
    .replace('封闭式商业不动产证券投资基金', 'REIT')
    .replace('证券投资基金', 'REIT');
}

export function assertAdmin(request: Request) {
  const password = request.headers.get('x-admin-password') || '';
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || password !== expected) {
    return new Response(
      JSON.stringify({ message: '管理员密码错误或尚未配置。' }),
      {
        status: 401,
        headers: jsonHeaders(),
      },
    );
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
    records: rows.results.length
      ? rows.results.map(rowToRecord)
      : seedRecordsForRange(start, end),
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
  options: {
    generateBriefs?: boolean;
    forceGenerate?: boolean;
    trigger?: 'scheduled' | 'manual' | 'recovery';
  } = {},
) {
  const { start, end } = weekRangeFor(dateText);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const triggerLabel =
    options.trigger === 'scheduled'
      ? '定时任务'
      : options.trigger === 'manual'
        ? '管理员手动更新'
        : '访问触发补抓';
  await db
    .prepare(
      'INSERT INTO fetch_runs (id, started_at, status, week_start, week_end, message) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      runId,
      startedAt,
      'running',
      start,
      end,
      `${triggerLabel}：开始抓取交易所数据。`,
    )
    .run();

  let message = '';
  let sseCount = 0;
  let szseCount = 0;
  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let runStatus: 'ok' | 'failed' = 'ok';
  try {
    const [sseResult, szseResult] = await Promise.allSettled([
      fetchSseRecords(start, end),
      fetchSzseRecords(start, end),
    ]);
    if (sseResult.status === 'rejected' && szseResult.status === 'rejected') {
      throw new Error(
        `上交所抓取失败（${describeFetchError(sseResult.reason)}）；深交所抓取失败（${describeFetchError(szseResult.reason)}）。`,
      );
    }

    const sseRecords = sseResult.status === 'fulfilled' ? sseResult.value : [];
    const szseRecords =
      szseResult.status === 'fulfilled' ? szseResult.value.records : [];
    sseCount = sseRecords.length;
    szseCount = szseRecords.length;
    for (const record of [...sseRecords, ...szseRecords]) {
      const existing = await findRecord(db, record.id);
      const sourceChanged =
        !existing || sourceSignature(existing) !== sourceSignature(record);
      const shouldGenerate = Boolean(
        options.generateBriefs && (options.forceGenerate || sourceChanged),
      );
      if (shouldGenerate) {
        try {
          const missing = missingRequiredMaterial(
            record.progressType,
            record.files,
          );
          if (missing.length)
            throw new Error(`缺少规定原文件：${missing.join('、')}`);
          const generationRecord = {
            ...record,
            files: record.files.length
              ? await addDocumentExcerpts(record.progressType, record.files)
              : [],
          };
          const generated = await generateDeepSeekBrief(generationRecord);
          record.brief = generated.brief;
          record.note = undefined;
          generatedCount += 1;
          inputTokens += generated.inputTokens;
          outputTokens += generated.outputTokens;
        } catch {
          failedCount += 1;
          if (existing) {
            record.brief = existing.brief;
            record.note = existing.note;
          } else if (record.progressType !== '申报') {
            record.brief =
              '本条简报暂未发布：规定原文件尚未成功读取，系统将在下次自动更新时重试。';
            record.note = '未使用缺失或无法读取的材料生成内容。';
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
    const sseMessage =
      sseResult.status === 'fulfilled'
        ? `上交所抓取 ${sseCount} 条`
        : '上交所抓取失败，本次保留已有数据';
    const szseMessage =
      szseResult.status === 'fulfilled'
        ? `深交所抓取 ${szseCount} 条${szseResult.value.warning ? `（${szseResult.value.warning}）` : ''}`
        : `深交所抓取失败，本次保留已有数据（${describeFetchError(szseResult.reason)}）`;
    message = `${triggerLabel}：${sseMessage}；${szseMessage}${aiMessage}。`;
    await db
      .prepare(
        'UPDATE fetch_runs SET finished_at = ?, status = ?, sse_count = ?, szse_count = ?, message = ? WHERE id = ?',
      )
      .bind(new Date().toISOString(), 'ok', sseCount, szseCount, message, runId)
      .run();
  } catch (error) {
    runStatus = 'failed';
    message = `${triggerLabel}：${error instanceof Error ? error.message : '抓取失败'}`;
    await db
      .prepare(
        'UPDATE fetch_runs SET finished_at = ?, status = ?, sse_count = ?, szse_count = ?, message = ? WHERE id = ?',
      )
      .bind(
        new Date().toISOString(),
        'failed',
        sseCount,
        szseCount,
        message,
        runId,
      )
      .run();
  }
  return {
    status: runStatus,
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
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      id,
      range.start,
      range.end,
      new Date().toISOString(),
      JSON.stringify(records),
    )
    .run();
  await db
    .prepare('UPDATE projects SET is_archived = 1 WHERE week_start = ?')
    .bind(range.start)
    .run();
  return { id, count: records.length };
}

async function fetchSseRecords(
  start: string,
  end: string,
): Promise<ReitsRecord[]> {
  const path = '/commonSoaQuery.do?isPagination=true&bond_type=4&sqlId=ZQ_XMLB&pageHelp.pageSize=50&pageHelp.cacheSize=1&pageHelp.pageNo=1&pageHelp.beginPage=1';
  const [data, bulletins] = await Promise.all([
    withRetry(() => fetchSseJson<{ result?: SseProject[] }>(path, SSE_REFERER)),
    fetchSseBulletins(start, end).catch(() => []),
  ]);
  const projects = (data.result || []).filter(
    (item) => item.PUBLISH_DATE >= start && item.PUBLISH_DATE <= end,
  );
  const projectRecords = await Promise.all(
    projects.map((project) => mapSseProject(project, start, end)),
  );
  const histories = new Map<string, Promise<SseBulletin[]>>();
  const announcementRecords = await Promise.all(
    bulletins
      .filter((item) => announcementStage(item.title))
      .map((item) => {
        if (!histories.has(item.securityCode)) {
          histories.set(
            item.securityCode,
            fetchSseBulletins('2021-01-01', end, item.securityCode),
          );
        }
        return mapSseBulletin(
          item,
          histories.get(item.securityCode)!,
          start,
          end,
        );
      }),
  );
  return [...projectRecords, ...announcementRecords];
}

async function withRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }
  }
  throw lastError;
}

async function fetchSzseRecords(start: string, end: string) {
  const listResults = await Promise.allSettled(
    ([21, 23] as const).map((bizType) => fetchSzseProjectList(bizType)),
  );
  const succeeded = listResults.filter(
    (result): result is PromiseFulfilledResult<SzseProjectWithOffering[]> =>
      result.status === 'fulfilled',
  );
  if (!succeeded.length) {
    throw new Error(
      listResults
        .map((result) =>
          describeFetchError(result.status === 'rejected' && result.reason),
        )
        .join('；'),
    );
  }
  const allProjects = succeeded.flatMap((result) => result.value);
  const projects = allProjects.filter(
    ({ project }) => project.updtdt >= start && project.updtdt <= end,
  );
  const projectRecords = await Promise.all(
    projects.map(({ project, offeringType }) =>
      mapSzseProject(project, offeringType, start, end),
    ),
  );
  const announcementRecords = await fetchSzseAnnouncementRecords(
    allProjects,
    start,
    end,
  );
  const failedKinds = listResults
    .map((result, index) =>
      result.status === 'rejected'
        ? index === 0
          ? '首发列表失败'
          : '新购入项目列表失败'
        : '',
    )
    .filter(Boolean);
  return {
    records: [...projectRecords, ...announcementRecords],
    warning: failedKinds.join('、'),
  };
}

async function fetchSzseProjectList(biztypsb: 21 | 23) {
  const query = new URLSearchParams({
    biztypsb: String(biztypsb),
    pageIndex: '0',
    pageSize: '200',
    bizType: '2',
  });
  const data = await fetchSzseJson<{ data?: SzseProject[] }>(
    `/api/reits/projectrends/query?${query}`,
  );
  if (!Array.isArray(data.data)) throw new Error('返回格式异常');
  const offeringType: OfferingType = biztypsb === 23 ? '扩募' : '首发';
  return (data.data || []).map((project) => ({ project, offeringType }));
}

async function mapSzseProject(
  project: SzseProject,
  offeringType: OfferingType,
  weekStart: string,
  weekEnd: string,
): Promise<ReitsRecord> {
  const detailUrl = `https://reits.szse.cn/projectdynamic/detail/index.html?id=${project.prjid}`;
  const detailResponse = await fetchSzseJson<{ data?: SzseProjectDetail }>(
    `/api/reits/projectrends/details?id=${project.prjid}`,
  ).catch(() => ({ data: undefined }));
  const detail = detailResponse.data;
  const files = detail ? szseFiles(detail) : [];
  const status = clean(project.prjst);
  const progressType = inferProjectStage(status, files);
  const shortName = briefName(project.cmpnm);
  const originator = clean(project.primitiveInterestsor);
  const fileText = files.length
    ? `。项目详情页同步披露${files.map((file) => `《${file.label}》`).join('、')}`
    : '';
  return {
    id: `szse-${project.prjid}-${project.updtdt}`,
    exchange: '深交所',
    fullName: project.cmpnm,
    shortName,
    title: titleFor(shortName, progressType, '深交所', offeringType),
    status,
    progressType,
    offeringType,
    updateDate: project.updtdt,
    weekStart,
    weekEnd,
    originator,
    brief: `${displayDate(project.updtdt)}，深交所网站显示，${shortName}项目状态为“${status}”，项目原始权益人为${originator}${fileText}。`,
    files: selectStageFiles(progressType, files),
    sourceUrl: detailUrl,
    sourceHtml: buildSzseSourceHtml(project, status, files),
  };
}

function szseFiles(detail: SzseProjectDetail): ReitsFile[] {
  const groups: Array<[string, SzseFile[] | undefined]> = [
    ['项目申报材料', detail.disclosureMaterials],
    ['问询与回复', detail.enquiryResponseAttachment],
    ['会议结论', detail.meetingConclusionAttachment],
    ['终止审核通知', detail.terminationNoticeAttachment],
    ['注册结果', detail.registrationResultAttachment],
    ['现金重组结果', detail.cashReorganizationResultAttachment],
  ];
  const seen = new Set<string>();
  return groups
    .flatMap(([section, group]) =>
      (group || []).map((file) => ({ file, section })),
    )
    .filter(
      ({ file }) =>
        Boolean(file.dfpth) && !seen.has(file.dfpth) && seen.add(file.dfpth),
    )
    .map(({ file, section }) => {
      const title =
        file.dfnm || file.configFileName || file.matnm || '项目披露文件';
      const kind = classifyDocument(title);
      return {
        label: documentLabel(kind),
        kind,
        originalTitle: title,
        publishedAt: file.dfdt || file.publishTime?.slice(0, 10),
        section,
        issuerRole:
          kind === '回复反馈'
            ? '原始权益人'
            : kind === '问询函'
              ? '交易所'
              : '披露主体',
        url: `${SZSE_FILE_BASE}${file.dfpth}`,
      };
    });
}

function buildSzseSourceHtml(
  project: SzseProject,
  status: string,
  files: ReitsFile[],
) {
  const fileList = files
    .map((file) => `<mark>${escapeHtml(file.label)}</mark>`)
    .join('、');
  const filesHtml = fileList
    ? `<p><span class="page-ref">附件列表</span>${fileList}</p>`
    : '';
  return `<h3>内容溯源</h3><p><span class="page-ref">项目动态页</span>${escapeHtml(project.cmpnm)}<mark>项目状态为“${escapeHtml(status)}”</mark>，更新时间为<mark>${escapeHtml(project.updtdt)}</mark>，项目原始权益人为<mark>${escapeHtml(clean(project.primitiveInterestsor))}</mark>。</p>${filesHtml}`;
}

async function mapSseProject(
  project: SseProject,
  weekStart: string,
  weekEnd: string,
): Promise<ReitsRecord> {
  const files = await fetchSseFiles(project.BOND_NUM).catch(() => []);
  const status = sseStatus(project);
  const progressType = inferProjectStage(status, files);
  const offeringType: OfferingType =
    project.REITS_TYPE === '1' ? '扩募' : '首发';
  const shortName = briefName(project.AUDIT_NAME);
  const title = titleFor(shortName, progressType, '上交所', offeringType);
  const selectedFiles = selectStageFiles(progressType, files);
  const feedbackFiles = selectedFiles.filter(
    (file) => file.kind !== '招募说明书',
  );
  const prospectus = selectedFiles.find((file) => file.kind === '招募说明书');
  return {
    id: `sse-${project.BOND_NUM}-${project.PUBLISH_DATE}`,
    exchange: '上交所',
    fullName: project.AUDIT_NAME,
    shortName,
    title,
    status,
    progressType,
    offeringType,
    updateDate: project.PUBLISH_DATE,
    weekStart,
    weekEnd,
    originator: clean(project.FULL_NAME),
    brief: buildSseBrief(project, progressType, feedbackFiles, prospectus),
    files: selectedFiles,
    sourceUrl: `${SSE_REFERER}index_detail.shtml?audit_id=${project.BOND_NUM}`,
    sourceHtml: buildSseSourceHtml(project, status, feedbackFiles, prospectus),
  };
}

async function fetchSseFiles(auditId: string): Promise<ReitsFile[]> {
  const path = `/commonSoaQuery.do?isPagination=false&audit_id=${encodeURIComponent(auditId)}&sqlId=ZQ_GGJG`;
  const data = await fetchSseJson<{ result?: SseFile[] }>(path, SSE_REFERER);
  return (data.result || []).map((file) => {
    const kind = classifyDocument(file.FILE_TITLE);
    return {
      label: documentLabel(kind),
      kind,
      originalTitle: file.FILE_TITLE,
      publishedAt: file.FILE_TIME,
      section:
        kind === '反馈意见' || kind === '回复反馈'
          ? '反馈意见及回复'
          : '项目申报材料',
      issuerRole:
        kind === '回复反馈'
          ? '原始权益人'
          : kind === '反馈意见'
            ? '交易所'
            : '披露主体',
      url: `${SSE_FILE_BASE}${file.FILE_PATH}`,
    };
  });
}

async function fetchSseBulletins(start: string, end: string, fundCode = '') {
  const query = new URLSearchParams({
    sqlId: 'REITS_BULLETIN',
    isPagination: 'true',
    fundCode,
    startDate: start,
    endDate: end,
    'pageHelp.pageSize': '200',
    'pageHelp.pageNo': '1',
  });
  const data = await withRetry(() =>
    fetchSseJson<{ result?: SseBulletin[] }>(`/commonSoaQuery.do?${query}`, SSE_BULLETIN_REFERER),
  );
  return data.result || [];
}

async function mapSseBulletin(
  bulletin: SseBulletin,
  historyPromise: Promise<SseBulletin[]>,
  weekStart: string,
  weekEnd: string,
): Promise<ReitsRecord> {
  const progressType = announcementStage(bulletin.title)!;
  const history = await historyPromise.catch(() => [bulletin]);
  const allFiles = history.map(sseBulletinFile);
  const files = selectStageFiles(progressType, allFiles);
  const offeringType: OfferingType = history.some((item) =>
    /扩募|新购入不动产/.test(item.title),
  )
    ? '扩募'
    : '首发';
  const shortName = clean(
    bulletin.fundExtAbbr ||
      bulletin.fundAbbr ||
      extractFundName(bulletin.title),
  );
  return {
    id: `sse-announcement-${bulletin.url.split('/').at(-1)?.replace(/\W/g, '-') || crypto.randomUUID()}`,
    exchange: '上交所',
    fullName: extractFundName(bulletin.title),
    shortName,
    title: titleFor(shortName, progressType, '上交所', offeringType),
    status: progressType,
    progressType,
    offeringType,
    updateDate: bulletin.sseDate,
    weekStart,
    weekEnd,
    brief: `${displayDate(bulletin.sseDate)}，${shortName}在上交所披露《${bulletin.title}》。`,
    files,
    sourceUrl: SSE_BULLETIN_REFERER,
    sourceHtml: buildAnnouncementSourceHtml(
      '上交所',
      bulletin.title,
      bulletin.sseDate,
      files,
    ),
  };
}

function sseBulletinFile(item: SseBulletin): ReitsFile {
  const kind = classifyDocument(item.title);
  return {
    label: documentLabel(kind),
    kind,
    originalTitle: item.title,
    publishedAt: item.sseDate,
    section: '信息披露 / REITs公告',
    issuerRole: '披露主体',
    url: `${SSE_ANNOUNCEMENT_BASE}${item.url}`,
  };
}

async function fetchSzseAnnouncementRecords(
  projects: SzseProjectWithOffering[],
  weekStart: string,
  weekEnd: string,
) {
  const query = new URLSearchParams({
    type: '4',
    pageSize: '100',
    pageNum: '1',
  });
  const data = await fetchJson<{ data?: SzseAnnouncement[] }>(
    `https://www.szse.cn/api/disc/info/find/tannInfo?${query}`,
    'https://www.szse.cn/www/reits/disclosure/index.html',
  ).catch(() => ({ data: [] }));
  const announcements = (data.data || []).filter((item) => {
    const date = item.publishTime.slice(0, 10);
    return (
      date >= weekStart &&
      date <= weekEnd &&
      Boolean(announcementStage(item.title))
    );
  });
  return Promise.all(
    announcements.map((item) =>
      mapSzseAnnouncement(item, projects, weekStart, weekEnd),
    ),
  );
}

async function mapSzseAnnouncement(
  announcement: SzseAnnouncement,
  projects: SzseProjectWithOffering[],
  weekStart: string,
  weekEnd: string,
): Promise<ReitsRecord> {
  const progressType = announcementStage(announcement.title)!;
  const matched = projects.find(({ project }) =>
    announcement.title.includes(project.cmpnm),
  );
  const detail = matched
    ? await fetchSzseJson<{ data?: SzseProjectDetail }>(
        `/api/reits/projectrends/details?id=${matched.project.prjid}`,
      ).catch(() => ({ data: undefined }))
    : { data: undefined };
  const primary = szseAnnouncementFile(announcement);
  const files = selectStageFiles(progressType, [
    primary,
    ...(detail.data ? szseFiles(detail.data) : []),
  ]);
  const offeringType: OfferingType =
    matched?.offeringType ||
    (/扩募|新购入不动产/.test(announcement.title) ? '扩募' : '首发');
  const shortName = clean(
    announcement.secName || briefName(extractFundName(announcement.title)),
  );
  const updateDate = announcement.publishTime.slice(0, 10);
  return {
    id: `szse-announcement-${announcement.id}`,
    exchange: '深交所',
    fullName: matched?.project.cmpnm || extractFundName(announcement.title),
    shortName,
    title: titleFor(shortName, progressType, '深交所', offeringType),
    status: progressType,
    progressType,
    offeringType,
    updateDate,
    weekStart,
    weekEnd,
    originator: matched
      ? clean(matched.project.primitiveInterestsor)
      : undefined,
    brief: `${displayDate(updateDate)}，${shortName}在深交所披露《${announcement.title}》。`,
    files,
    sourceUrl: 'https://reits.szse.cn/disclosure/',
    sourceHtml: buildAnnouncementSourceHtml(
      '深交所',
      announcement.title,
      updateDate,
      files,
    ),
  };
}

function szseAnnouncementFile(item: SzseAnnouncement): ReitsFile {
  const kind = classifyDocument(item.title);
  return {
    label: documentLabel(kind),
    kind,
    originalTitle: item.title,
    publishedAt: item.publishTime.slice(0, 10),
    section: '信息披露',
    issuerRole: '披露主体',
    url: `${SZSE_ANNOUNCEMENT_BASE}${item.attachPath}`,
  };
}

function buildAnnouncementSourceHtml(
  exchange: string,
  title: string,
  date: string,
  files: ReitsFile[],
) {
  const fileList = files
    .map((file) => `<mark>${escapeHtml(file.originalTitle)}</mark>`)
    .join('、');
  return `<h3>内容溯源</h3><p><span class="page-ref">信息披露</span>${exchange}于<mark>${date}</mark>披露<mark>${escapeHtml(title)}</mark>。</p><p><span class="page-ref">本条实际参考文件</span>${fileList}</p>`;
}

function extractFundName(title: string) {
  const withoutPrefix = title.includes('：')
    ? title.split('：').slice(1).join('：')
    : title;
  return (
    withoutPrefix.match(
      /[\u4e00-\u9fffA-Za-z0-9（）()·-]+封闭式(?:基础设施|商业不动产)证券投资基金/,
    )?.[0] ||
    withoutPrefix
      .replace(
        /(?:基金份额)?(?:询价|发售|上市交易提示性|认购申请确认比例结果).*$/,
        '',
      )
      .trim()
  );
}

async function fetchJson<T>(url: string, referer: string): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json, text/plain, */*',
      referer,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`交易所接口返回 ${response.status}`);
  return (await response.json()) as T;
}

async function fetchSseJson<T>(path: string, referer: string): Promise<T> {
  const failures: string[] = [];
  for (const origin of SSE_QUERY_ORIGINS) {
    try {
      return await fetchJson<T>(`${origin}${path}`, referer);
    } catch (error) {
      failures.push(`${origin.startsWith('https:') ? 'HTTPS' : 'HTTP'} ${describeFetchError(error)}`);
    }
  }
  throw new Error([...new Set(failures)].join('、'));
}

async function fetchSzseJson<T>(path: string): Promise<T> {
  const failures: string[] = [];
  for (const origin of SZSE_ORIGINS) {
    const referer = `${origin}/projectdynamic/index.html`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fetchJson<T>(`${origin}${path}`, referer);
      } catch (error) {
        failures.push(
          `${origin.startsWith('https:') ? 'HTTPS' : 'HTTP'} ${describeFetchError(error)}`,
        );
      }
    }
  }
  throw new Error([...new Set(failures)].join('、'));
}

function describeFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const status = message.match(/(?:返回|HTTP)\s*(\d{3})/)?.[1];
  if (status) return `HTTP ${status}`;
  if (/timeout|timed out|aborted/i.test(message)) return '连接超时';
  if (/json|unexpected token|返回格式/i.test(message)) return '返回格式异常';
  if (/fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message))
    return '网络连接失败';
  return message.slice(0, 80) || '未知网络错误';
}

function buildSseBrief(
  project: SseProject,
  progressType: string,
  feedbackFiles: ReitsFile[],
  prospectus?: ReitsFile,
) {
  const date = displayDate(project.PUBLISH_DATE);
  const shortName = briefName(project.AUDIT_NAME);
  const originator = clean(project.FULL_NAME);
  if (progressType === '反馈/问询') {
    const fileText = feedbackFiles.length
      ? `，并披露${feedbackFiles.map((file) => `《${file.label}》`).join('、')}`
      : '';
    return `${date}，上交所网站显示，${shortName}项目状态更新为“${sseStatus(project)}”${fileText}，项目原始权益人为${originator}。`;
  }
  if (progressType === '受理') {
    return `${date}，上交所网站显示，${shortName}项目状态为“已受理”，项目原始权益人为${originator}。${prospectus ? `项目详情页已披露《${prospectus.label}》。` : ''}`;
  }
  return `${date}，上交所网站显示，${shortName}项目状态为“${sseStatus(project)}”，项目原始权益人为${originator}。`;
}

function buildSseSourceHtml(
  project: SseProject,
  status: string,
  files: ReitsFile[],
  prospectus?: ReitsFile,
) {
  const fileList = [...files, ...(prospectus ? [prospectus] : [])]
    .map((file) => `<mark>${escapeHtml(file.label)}</mark>`)
    .join('、');
  const filesHtml = fileList
    ? `<p><span class="page-ref">附件列表</span>${fileList}</p>`
    : '';
  return `<h3>内容溯源</h3><p><span class="page-ref">项目动态页</span>${escapeHtml(project.AUDIT_NAME)}<mark>项目状态为“${status}”</mark>，更新时间为<mark>${project.PUBLISH_DATE}</mark>，项目原始权益人为<mark>${escapeHtml(clean(project.FULL_NAME))}</mark>。</p>${filesHtml}`;
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
    offeringType: rawRecord(row).offeringType === '扩募' ? '扩募' : '首发',
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

function rawRecord(row: Record<string, unknown>): Partial<ReitsRecord> {
  try {
    return JSON.parse(String(row.raw_json || '{}')) as Partial<ReitsRecord>;
  } catch {
    return {};
  }
}

function seedRecordsForRange(start: string, end: string) {
  return seedRecords
    .filter((record) => record.updateDate >= start && record.updateDate <= end)
    .map((record) => ({ ...record, weekStart: start, weekEnd: end }));
}

function titleFor(
  shortName: string,
  progressType: string,
  exchange: string,
  offeringType: OfferingType,
) {
  const actionName = offeringType === '扩募' ? `${shortName}扩募` : shortName;
  if (progressType === '反馈/问询')
    return exchange === '深交所'
      ? `${actionName}获深交所问询`
      : `${actionName}获上交所反馈意见`;
  if (progressType === '回复反馈') return `${actionName}回复反馈`;
  if (progressType === '受理') return `${actionName}获受理`;
  if (progressType === '申报') return `${actionName}申报至${exchange}`;
  if (progressType === '注册生效') return `${actionName}获批`;
  if (progressType === '询价') return `${actionName}发布询价公告`;
  if (progressType === '发售') return `${actionName}发布基金份额发售公告`;
  if (progressType === '认购结果') return `${actionName}披露认购申请确认比例`;
  if (progressType === '上市') return `${actionName}正式上市`;
  return `${actionName}${progressType}`;
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
  REITS_TYPE?: string;
};

type SseFile = {
  FILE_TITLE: string;
  FILE_PATH: string;
  FILE_TIME?: string;
};

type SseBulletin = {
  fundAbbr?: string;
  fundExtAbbr?: string;
  securityCode: string;
  sseDate: string;
  title: string;
  url: string;
};

type SzseProject = {
  prjid: number;
  cmpnm: string;
  prjst: string;
  updtdt: string;
  primitiveInterestsor: string;
};

type SzseFile = {
  dfnm?: string;
  configFileName?: string;
  matnm?: string;
  dfpth: string;
  dfdt?: string;
  publishTime?: string;
};

type SzseProjectWithOffering = {
  project: SzseProject;
  offeringType: OfferingType;
};

type SzseAnnouncement = {
  id: string;
  title: string;
  publishTime: string;
  attachPath: string;
  secCode: string;
  secName: string;
};

type SzseProjectDetail = {
  disclosureMaterials?: SzseFile[];
  enquiryResponseAttachment?: SzseFile[];
  meetingConclusionAttachment?: SzseFile[];
  terminationNoticeAttachment?: SzseFile[];
  registrationResultAttachment?: SzseFile[];
  cashReorganizationResultAttachment?: SzseFile[];
};
