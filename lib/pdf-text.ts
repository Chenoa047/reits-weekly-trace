import type { ReitsSourceFile } from '@/lib/reits-rules';
import { describeFetchError } from './fetch-error.ts';
import { REPLY_OTHER_TOPICS } from './reply-topics.ts';
import { replyAnswerText, replyValuationFacts } from './reply-facts.ts';
import { prospectusAssetFacts } from './prospectus-assets.ts';

const MAX_PAGES = 600;
const MAX_TOTAL_EXCERPT_CHARS = 45_000;

export async function addDocumentExcerpts(
  stage: string,
  files: ReitsSourceFile[],
) {
  const perFileLimit = Math.floor(MAX_TOTAL_EXCERPT_CHARS / Math.max(files.length, 1));
  const hydrated: ReitsSourceFile[] = [];
  for (const file of files) {
    hydrated.push({ ...file, content: await extractPdfText(file.url) });
  }
  return hydrated.map((file) => ({
    ...file,
    content: selectRelevantText(
      file.content || '',
      stage === '认购结果' && file.kind === '发售'
        ? '认购定价'
        : stage === '询价' && file.kind === '招募说明书'
        ? '询价资产'
        : stage === '发售' && file.kind === '招募说明书'
          ? '发售资产'
        : (stage === '反馈/问询' || stage === '认购结果') && file.kind === '招募说明书'
          ? '反馈资产'
          : stage,
      perFileLimit,
    ),
  }));
}

async function extractPdfText(url: string) {
  const response = await downloadPdf(url);
  const contentType = response.headers.get('content-type') || '';
  if (
    !contentType.toLowerCase().includes('pdf') &&
    !url.toLowerCase().includes('.pdf')
  ) {
    throw new Error('原文件不是 PDF');
  }

  const data = new Uint8Array(await response.arrayBuffer());
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: data.slice(),
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const line = text.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) pages.push(`[第${pageNumber}页] ${line}`);
  }
  await loadingTask.destroy();
  const result = pages.join('\n');
  if (isPdfTextTooSparse(result, pageCount)) {
    const { extractPdfTextWithOcr } = await import('./pdf-ocr.ts');
    return extractPdfTextWithOcr(data, pageCount);
  }
  return result;
}

export function isPdfTextTooSparse(text: string, pageCount: number) {
  const meaningfulCharacters = text
    .replace(/\[第\d+页\]/g, '')
    .replace(/\s/g, '').length;
  const populatedPages = text
    .split(/(?=\[第\d+页\])/)
    .filter(
      (page) =>
        page.replace(/\[第\d+页\]/g, '').replace(/\s/g, '').length >= 40,
    ).length;
  return (
    meaningfulCharacters < Math.max(40, pageCount * 40) ||
    populatedPages < Math.max(1, Math.ceil(pageCount * 0.2))
  );
}

async function downloadPdf(url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9',
          referer: pdfReferer(url),
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`原文件下载失败：${describeFetchError(lastError)}`);
}

function pdfReferer(url: string) {
  return new URL(url).hostname.endsWith('szse.cn')
    ? 'https://reits.szse.cn/projectdynamic/index.html'
    : 'https://www.sse.com.cn/reits/info/';
}

export function selectRelevantText(text: string, stage: string, limit: number) {
  if (text.length <= limit) return text;
  if (stage === '认购定价') {
    const matches = [...text.matchAll(/(?:认购价格|发售价格)(?:为|：|:)?\s*\d[\d.]*/g)];
    if (!matches.length) return text.slice(0, limit);
    return matches.slice(0, 3).map(match => {
      const start = Math.max(0, match.index - 150);
      const marker = text.slice(0, start).match(/\[第\d+页\]/g)?.at(-1) || '';
      return `${marker} ${text.slice(start, start + Math.floor(limit / 3) - 20)}`;
    }).join('\n').slice(0, limit);
  }
  if (stage === '反馈/问询') return selectFeedbackText(text, limit);
  if (stage === '回复反馈') return selectReplyText(text, limit);
  const keywords: Record<string, string[]> = {
    受理: [
      '原始权益人',
      '基础设施项目',
      '底层资产',
      '评估值',
      '出租率',
      '运营收入',
    ],
    注册生效: [
      '原始权益人',
      '基础设施项目',
      '底层资产',
      '评估值',
      '评估基准日',
      '运营收入',
    ],
    '反馈/问询': [
      '反馈问题',
      '问询问题',
      '请基金管理人',
      '请律师',
      '请评估机构',
      '原始权益人',
      '底层资产',
      '基础设施项目',
      '不动产项目',
      '建筑面积',
      '可供出租面积',
    ],
    询价: ['证监许可', '基金代码', '询价区间', '询价日', '募集期', '发售份额', '战略配售', '网下发售', '公众投资者'],
    询价资产: ['底层资产', '基础设施项目', '不动产项目', '项目位于', '建筑面积', '装机容量', '原始权益人'],
    反馈资产: ['本基金拟持有的不动产项目', '项目所在地', '总建筑面积', '不动产项目名称', '不动产项目概况表', '土地使用权面积', '占地面积', '装机容量', '底层资产', '基础设施项目', '不动产项目', '项目位于', '建筑面积'],
    发售: ['证监许可', '基金代码', '认购价格', '运作方式', '存续期限', '发售份额总额', '战略配售', '网下发售', '公众投资者'],
    发售资产: ['底层资产', '基础设施项目', '不动产项目', '项目位于', '建筑面积', '装机容量', '原始权益人'],
    认购结果: ['基金份额总额', '战略配售', '网下发售', '公众投资者', '有效认购', '确认比例', '认购倍数', '募集规模', '认购价格'],
    上市: ['上市日期', '交易代码', '基金份额', '募集规模', '认购价格'],
  };
  const windows: string[] = [];
  if (stage === '反馈资产') {
    const expansion = /本基金本次扩募/.test(text.replace(/\s/g, ''));
    const facts = prospectusAssetFacts([{ kind: '招募说明书', url: '', originalTitle: expansion ? '扩募招募说明书' : '招募说明书', content: text }]);
    // Keep the scope and complete table pages before generic keyword windows.
    windows.push(...text.split(/(?=\[第\d+页\])/).filter(part => {
      const page = Number(part.match(/^\[第(\d+)页\]/)?.[1]);
      const normalized = part.normalize('NFKC').replace(/\s/g, '');
      return /本基金本次扩募(?:发售)?概况/.test(normalized) || facts.some(fact => fact.evidence.some(item => item.page === page && normalized.includes(item.quote)));
    }));
  }
  for (const keyword of keywords[stage] || []) {
    let from = 0;
    for (let count = 0; count < (stage === '询价资产' || stage === '反馈资产' || stage === '发售资产' ? 1 : 12); count += 1) {
      const index = text.indexOf(keyword, from);
      if (index < 0) break;
      const start = Math.max(0, index - 900);
      const window = text.slice(start, Math.min(text.length, index + 2_100));
      const markerStart = text.lastIndexOf('[第', start);
      const pageMarker = markerStart >= 0
        ? text.slice(markerStart, start).match(/^\[第\d+页\]/)?.[0]
        : undefined;
      windows.push(pageMarker && !window.startsWith('[第') ? `${pageMarker} ${window}` : window);
      from = index + keyword.length;
    }
  }
  windows.push(text.slice(0, Math.min(8_000, limit)));
  return [...new Set(windows)].join('\n').slice(0, limit);
}

function selectReplyText(text: string, limit: number) {
  const facts = replyValuationFacts([{ kind: '回复反馈', originalTitle: '反馈意见的答复', url: '', content: text }]);
  const required = facts.flatMap(fact => fact.evidence.map(item => `[第${item.page}页] ${item.quote}`)).join('\n');
  text = replyAnswerText(text);
  const topics = [
    /(?:整体|合计)评估值|评估值.{0,40}\d|估值.{0,20}(?:下降|上升|调整)/,
    /估值参数|联营扣率|出租率|租金增长率|长期增长率|收缴率|折现率/,
    ...REPLY_OTHER_TOPICS,
  ];
  const indices = [...new Set(topics.flatMap((topic) => {
    const matches = [...text.matchAll(new RegExp(topic.source, 'g'))];
    return matches.length ? [matches[0].index, matches.at(-1)!.index] : [];
  }))];
  if (!indices.length) return `${required}\n${text}`.slice(0, limit);
  const perTopicLimit = Math.max(0, Math.floor((limit - required.length - 1) / indices.length) - 20);
  return `${required}\n${indices.sort((left, right) => left - right).map((index) => {
    const start = Math.max(0, index - Math.min(200, Math.floor(perTopicLimit / 4)));
    const excerpt = text.slice(start, start + perTopicLimit);
    const pageMarker = text.slice(0, start).match(/\[第\d+页\]/g)?.at(-1);
    return pageMarker && !excerpt.startsWith('[第') ? `${pageMarker} ${excerpt}` : excerpt;
  }).join('\n')}`.slice(0, limit);
}

function selectFeedbackText(text: string, limit: number) {
  const headings = [...text.matchAll(/(?<![（(一二三四五六七八九十])[一二三四五六七八九十]{1,3}[、.．]\s*[^。；\n（(]{2,55}/g)];
  const other = [...text.matchAll(/[一二三四五六七八九十]{1,3}[、.．]\s*其他(?:反馈意见|反馈问题|问询问题|问询事项)/g)].at(-1);
  const excerpt = (index: number, value: string) => `${text.slice(0, index).match(/\[第\d+页\]/g)?.at(-1) || ''} ${value}`;
  // Reserve the budget for all main headings, rather than consuming it on the first few detailed questions.
  const required = headings.map(heading => excerpt(heading.index, heading[0])).join('\n') +
    (other ? `\n${excerpt(other.index, text.slice(other.index, other.index + 4_000))}` : '');
  return `${required}\n${text.slice(0, Math.max(0, limit - required.length - 1))}`.slice(0, limit);
}
