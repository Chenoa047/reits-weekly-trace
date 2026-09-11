import type { ReitsSourceFile } from '@/lib/reits-rules';

const MAX_PAGES = 600;
const MAX_TOTAL_EXCERPT_CHARS = 100_000;

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
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': 'Mozilla/5.0 REITsBrief/1.0' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`原文件下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (
    !contentType.toLowerCase().includes('pdf') &&
    !url.toLowerCase().includes('.pdf')
  ) {
    throw new Error('原文件不是 PDF');
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await response.arrayBuffer()),
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
  if (!result) throw new Error('原文件未解析出可用文字');
  return result;
}

function selectRelevantText(text: string, stage: string, limit: number) {
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
    ],
    回复反馈: ['回复', '评估基准日', '评估值', '出租率', '折现率', '现金流'],
    询价: ['询价区间', '询价日', '募集期', '发售份额', '募集规模'],
    发售: ['认购价格', '发售时间', '战略配售', '网下发售', '公众投资者'],
    认购结果: ['有效认购', '确认比例', '认购倍数', '募集规模', '认购价格'],
    上市: ['上市日期', '交易代码', '基金份额', '募集规模', '认购价格'],
  };
  const windows: string[] = [text.slice(0, 20_000)];
  for (const keyword of keywords[stage] || []) {
    let from = 0;
    for (let count = 0; count < 12; count += 1) {
      const index = text.indexOf(keyword, from);
      if (index < 0) break;
      windows.push(
        text.slice(
          Math.max(0, index - 900),
          Math.min(text.length, index + 2_100),
        ),
      );
      from = index + keyword.length;
    }
  }
  return [...new Set(windows)].join('\n').slice(0, limit);
}
