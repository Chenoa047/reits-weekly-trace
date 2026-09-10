import { env } from 'cloudflare:workers';

type BriefMaterial = {
  exchange: string;
  shortName: string;
  status: string;
  progressType: string;
  updateDate: string;
  originator?: string;
  brief: string;
  sourceHtml: string;
  files: Array<{ label: string; url: string }>;
};

export type DeepSeekBriefResult = {
  brief: string;
  inputTokens: number;
  outputTokens: number;
};

export async function generateDeepSeekBrief(record: BriefMaterial): Promise<DeepSeekBriefResult> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('not_configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch('https://api.deepseek.com/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        reasoning: { effort: 'low' },
        max_output_tokens: 1600,
        instructions: buildInstructions(),
        input: buildMaterial(record),
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(classifyDeepSeekError(response.status));
    const data = (await response.json()) as DeepSeekResponse;
    const brief = normalizeBrief(extractOutputText(data));
    validateBrief(brief);
    return {
      brief,
      inputTokens: numberValue(data.usage?.input_tokens),
      outputTokens: numberValue(data.usage?.output_tokens),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function sourceSignature(record: BriefMaterial) {
  return JSON.stringify({
    exchange: record.exchange,
    status: record.status,
    progressType: record.progressType,
    updateDate: record.updateDate,
    originator: record.originator || '',
    sourceHtml: record.sourceHtml,
    files: record.files.map((file) => ({ label: file.label, url: file.url })),
  });
}

function buildInstructions() {
  return `你是公募REITs行业周报撰写助手。请仅依据用户提供的交易所材料，输出一段250至400字的中文简报正文。
要求：使用金融专业书面语并客观陈述；不得分点；不得使用感叹号；不得编造材料未披露的信息；不得机械复述字段名称；不得重复简报标题；材料不足时明确说明未披露，不得引用外部知识。只输出正文，不要标题、解释、引用列表或Markdown。`;
}

function buildMaterial(record: BriefMaterial) {
  return `交易所：${record.exchange}
项目简称：${record.shortName}
项目状态：${record.status}
进度类型：${record.progressType}
更新时间：${record.updateDate}
原始权益人：${record.originator || '材料未披露'}
当前规则底稿：${record.brief}
交易所原文摘录：${stripHtml(record.sourceHtml) || '暂无结构化原文摘录'}
相关文件：${record.files.map((file) => `${file.label}：${file.url}`).join('；') || '暂无需展示的原文件'}`;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeBrief(value: string) {
  return value
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^简报正文[：:]?\s*/, '')
    .replace(/\r?\n+/g, ' ')
    .trim();
}

function validateBrief(value: string) {
  const length = Array.from(value.replace(/\s/g, '')).length;
  if (length < 250 || length > 400) throw new Error('invalid_length');
  if (/[!！]/.test(value)) throw new Error('invalid_format');
  if (/(^|\s)[-•·]\s|(^|\s)\d+[.、]\s/.test(value)) throw new Error('invalid_format');
}

function classifyDeepSeekError(status: number) {
  if (status === 401) return 'authentication_failed';
  if (status === 402) return 'insufficient_balance';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'request_failed';
}

function extractOutputText(data: DeepSeekResponse) {
  if (typeof data.output_text === 'string') return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text || '')
    .join('\n');
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type DeepSeekResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
