type BriefMaterial = {
  exchange: string;
  shortName: string;
  status: string;
  progressType: string;
  offeringType: '首发' | '扩募';
  updateDate: string;
  originator?: string;
  brief: string;
  sourceHtml: string;
  files: Array<{
    label: string;
    url: string;
    kind: string;
    originalTitle: string;
    publishedAt?: string;
    section?: string;
    issuerRole?: string;
    content?: string;
  }>;
};

export const BRIEF_RULES_VERSION = '2026-09-16-v1';

export type DeepSeekBriefResult = {
  brief: string;
  inputTokens: number;
  outputTokens: number;
};

export async function generateDeepSeekBrief(
  record: BriefMaterial,
): Promise<DeepSeekBriefResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
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
        instructions: buildInstructions(record),
        input: buildMaterial(record),
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(classifyDeepSeekError(response.status));
    const data = (await response.json()) as DeepSeekResponse;
    if (data.status === 'incomplete' || data.incomplete_details)
      throw new Error('incomplete_response');
    const brief = normalizeBrief(extractOutputText(data));
    validateBrief(brief, record);
    return {
      brief,
      inputTokens: numberValue(data.usage?.input_tokens),
      outputTokens: numberValue(data.usage?.output_tokens),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      throw new Error('timeout');
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
    offeringType: record.offeringType,
    updateDate: record.updateDate,
    originator: record.originator || '',
    sourceHtml: record.sourceHtml,
    files: record.files.map((file) => ({
      kind: file.kind,
      originalTitle: file.originalTitle,
      publishedAt: file.publishedAt || '',
      url: file.url,
    })),
  });
}

export function needsBriefRegeneration(
  existing: (BriefMaterial & { briefRulesVersion?: string }) | null,
  incoming: BriefMaterial,
  force = false,
) {
  return force || !existing ||
    existing.briefRulesVersion !== BRIEF_RULES_VERSION ||
    sourceSignature(existing) !== sourceSignature(incoming) ||
    !isBriefDisplayable(existing.brief, incoming.progressType);
}

function buildInstructions(record: BriefMaterial) {
  return `你是公募REITs行业周报撰写助手。只依据用户提供的交易所页面、公告和文件摘录撰写一段中文简报正文，不得调用外部知识。

通用规则：
1. 使用金融专业书面语，客观、紧凑、单段呈现；不分点、不使用感叹号，不重复标题。必须以完整句子和句号结尾，不能逐项照抄文件目录或问询条目。
2. 正文使用项目简称，不写基金全称；删除“项目申报类型为首次发售”“资产类型为基础设施”“交易所项目动态信息显示”“项目发起人即”等机械字段，也不写基金管理人、专项计划名称或“此前于某日获受理”等无关流程回顾。
3. 每个事实只能来自下方“允许使用的原文件摘录”；项目动态页只可用于确认本次进度、交易所和日期。唯一例外是“申报”阶段，可使用项目动态页已经披露的原始权益人。不得依据文件名推断正文，不得使用外部知识，不得补齐材料中没有的信息。不同文件相互矛盾时写明“披露文件数据存在差异，待核验”，不得自行选择、拼接或修正。
4. 申报且无附件时，只写状态及交易所页面已经披露的事实，不强行补充底层资产、估值或发行安排，也不为了凑字数反复说明“尚未披露”。材料不足时允许一两句短稿；内容多少由可核验事实决定，不为达到固定字数添加空话。
5. 反馈/问询只概括监管关注的大类主题，通常一至两句，不展开逐项问题；回复反馈优先写估值参数、评估基准日和评估值变化，再概括其他回复；所有比例和金额应交叉核算。材料未给出变化数据时，不得硬写估值变化。
6. 首发与扩募是项目属性，不是进度。本项目属性由结构化字段明确给出，不得自行判断。扩募项目正文必须明确“扩募”，资产部分只介绍本次新增资产。
7. 只输出正文，不输出标题、说明、引用列表、页码或Markdown。

本条阶段规则：${stageInstruction(record)}`;
}

function buildMaterial(record: BriefMaterial) {
  return `交易所：${record.exchange}
项目简称：${record.shortName}
项目状态：${record.status}
进度类型：${record.progressType}
项目属性：${record.offeringType}
更新时间：${record.updateDate}
原始权益人（仅申报阶段可直接使用此项目页字段）：${record.progressType === '申报' ? record.originator || '材料未披露' : '必须从允许使用的原文件正文核验'}
交易所原文摘录（仅申报阶段可用于事实描述）：${record.progressType === '申报' ? stripHtml(record.sourceHtml) || '暂无结构化原文摘录' : '其他阶段仅用结构化进度、交易所和日期；原始权益人与资产事实必须从下方原文件正文核验'}
允许使用的原文件摘录：${
    record.files
      .map(
        (file, index) => `
[文件${index + 1}]
类型：${file.kind}
原始标题：${file.originalTitle}
披露日期：${file.publishedAt || '未标注'}
栏目：${file.section || '未标注'}
发布方角色：${file.issuerRole || '披露主体'}
正文摘录：${file.content || '未成功读取，不得引用该文件中的事实'}`,
      )
      .join('\n') || '无附件；本条只能使用项目动态页事实'
  }`;
}

function stageInstruction(record: BriefMaterial) {
  const expansion =
    record.offeringType === '扩募'
      ? '本项目为扩募，只写本次新增资产和本次扩募事项。'
      : '';
  const rules: Record<string, string> = {
    申报: '按“时间—交易所—已申报—原始权益人”的顺序写；无招募说明书时不写底层资产。',
    受理: '只依据最新招募说明书，按“时间—获受理—原始权益人—底层资产核心参数”的顺序写。',
    '反馈/问询':
      '只依据交易所出具的反馈意见或问询函，概括“时间—监管动作—主要关注主题—其他意见”。',
    回复反馈: '依据交易所问询和原始权益人回复，写“时间—回复动作—回复文件确有披露的主要变化—其他主要回复”；项目背景也必须来自允许使用的原文件。',
    注册生效: '只依据最新招募说明书，写“时间—注册生效—本次资产概况”；仅当文件确有前后数据时写估值变化和持有方。',
    询价: '以询价公告为主，只有该公告未覆盖时才可用最新招募说明书补充资产信息。',
    发售: '以发售公告为主，只有该公告未覆盖时才可用最新招募说明书补充资产信息。',
    认购结果: '以认购结果公告为主，只有该公告未覆盖时才可用最新招募说明书补充资产信息。',
    上市: '以上市交易提示性公告为主，可用最新招募说明书、发售公告和认购结果公告交叉补充。',
  };
  return `${rules[record.progressType] || '围绕本次最新披露动作和可核验事实撰写。'}${expansion}`;
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function isCompleteBrief(value: string) {
  return value.trim().endsWith('。');
}

export function isBriefDisplayable(value: string, stage: string) {
  const length = Array.from(value.replace(/\s/g, '')).length;
  return isCompleteBrief(value) &&
    (stage !== '反馈/问询' || length <= 280);
}

export function validateBrief(value: string, record: BriefMaterial) {
  if (!isCompleteBrief(value)) throw new Error('incomplete_sentence');
  const length = Array.from(value.replace(/\s/g, '')).length;
  const minimum =
    record.progressType === '申报' && record.files.length === 0 ? 25 : 60;
  const maximum = record.progressType === '反馈/问询' ? 280 : 400;
  if (length < minimum || length > maximum) throw new Error('invalid_length');
  if (/[!！]/.test(value)) throw new Error('invalid_format');
  if (/(^|\s)[-•·]\s|(^|\s)\d+[.、]\s/.test(value))
    throw new Error('invalid_format');
  if (/附件正文尚未解析|无法核验|未成功读取|根据公开资料/.test(value))
    throw new Error('invalid_meta_content');
  if (record.offeringType === '扩募' && !value.includes('扩募'))
    throw new Error('missing_expansion_label');
  if (record.progressType === '反馈/问询' && /(?:^|[。；])(?:[一二三四五六七八九十]+、|\d+[、.])/.test(value))
    throw new Error('invalid_format');
  validateNumbers(value, record);
}

function validateNumbers(value: string, record: BriefMaterial) {
  const source =
    `${record.progressType === '申报' ? stripHtml(record.sourceHtml) : ''}\n${record.files.map((file) => file.content || '').join('\n')}`.replace(
      /[,，\s]/g,
      '',
    );
  const numbers =
    value.match(/\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:亿|万)?元|\d+(?:\.\d+)?倍/g) ||
    [];
  for (const number of numbers) {
    if (!source.includes(number.replace(/[,，\s]/g, '')))
      throw new Error('unsupported_number');
  }
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
    .filter(
      (content) =>
        content.type === 'output_text' && typeof content.text === 'string',
    )
    .map((content) => content.text || '')
    .join('\n');
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type DeepSeekResponse = {
  status?: string;
  incomplete_details?: unknown;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
