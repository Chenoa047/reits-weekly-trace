import type { ReitsSourceFile } from '@/lib/reits-rules';
import { describeFetchError } from './fetch-error.ts';

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
    content: selectRelevantText(file.content || '', stage, perFileLimit),
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
    回复反馈: ['回复', '评估基准日', '评估值', '出租率', '折现率', '现金流'],
    询价: ['询价区间', '询价日', '募集期', '发售份额', '募集规模'],
    发售: ['认购价格', '发售时间', '战略配售', '网下发售', '公众投资者'],
    认购结果: ['有效认购', '确认比例', '认购倍数', '募集规模', '认购价格'],
    上市: ['上市日期', '交易代码', '基金份额', '募集规模', '认购价格'],
  };
  const windows: string[] = [];
  for (const keyword of keywords[stage] || []) {
    let from = 0;
    for (let count = 0; count < 12; count += 1) {
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
