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
    const brief = normalizeBrief(extractOutputText(data));
    validateBrief(brief, record);
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

function buildInstructions(record: BriefMaterial) {
  return `你是公募REITs行业周报撰写助手。只依据用户提供的交易所页面、公告和文件摘录撰写一段中文简报正文，不得调用外部知识。

通用规则：
1. 使用金融专业书面语，客观、紧凑、单段呈现；不分点、不使用感叹号，不重复标题。
2. 正文使用项目简称，不写基金全称；删除“项目申报类型为首次发售”“资产类型为基础设施”“交易所项目动态信息显示”“项目发起人即”等机械字段，也不写基金管理人、专项计划名称或“此前于某日获受理”等无关流程回顾。
3. 信息以本次最新文件为先；最新文件未涉及的字段，才可沿用同项目最新招募说明书。不同文件相互矛盾时写明“披露文件数据存在差异，待核验”，不得自行选择、拼接或修正。
4. 申报且无附件时，只写状态及交易所页面已经披露的事实，不强行补充底层资产、估值或发行安排，也不为了凑字数反复说明“尚未披露”。材料充分时控制在250至400字；无附件的申报项目可短至80至180字。
5. 反馈/问询只概括监管关注的大类主题，不展开逐项问题；回复反馈优先写估值参数、评估基准日和评估值变化，再概括其他回复；所有比例和金额应交叉核算。
6. 首发与扩募是项目属性，不是进度。扩募项目沿用对应阶段模板，标题和正文明确“扩募”，资产部分只介绍本次新增资产。
7. 只输出正文，不输出标题、说明、引用列表、页码或Markdown。

本条阶段规则：${stageInstruction(record)}`;
}

function buildMaterial(record: BriefMaterial) {
  return `交易所：${record.exchange}
项目简称：${record.shortName}
项目状态：${record.status}
进度类型：${record.progressType}
更新时间：${record.updateDate}
原始权益人：${record.originator || '材料未披露'}
可复用事实底稿（不得照搬其中不合规则的措辞）：${record.brief}
交易所原文摘录：${stripHtml(record.sourceHtml) || '暂无结构化原文摘录'}
相关文件：${record.files.map((file) => file.label).join('；') || '无附件'}`;
}

function stageInstruction(record: BriefMaterial) {
  const expansion = /扩募/.test(`${record.shortName}${record.progressType}${record.files.map((file) => file.label).join('')}`)
    ? '本项目为扩募，只写本次新增资产和本次扩募事项。'
    : '';
  const rules: Record<string, string> = {
    申报: '按“时间—交易所—已申报—原始权益人”的顺序写；无招募说明书时不写底层资产。',
    受理: '按“时间—获受理—原始权益人—底层资产核心参数”的顺序写，以招募说明书为准。',
    '反馈/问询': '按“时间—监管动作—主要关注主题—其他意见—资产与原始权益人背景”的顺序写。',
    回复反馈: '按“时间—回复动作—估值参数与评估值变化—其他主要回复—项目背景”的顺序写。',
    注册生效: '按“时间—注册生效—资产概况—估值变化—资产持有方”的顺序写。',
    询价: '写询价区间、询价时间、预计募集期和资产概况。',
    发售: '写认购价格、发售时间、份额结构、预计募集规模和资产概况。',
    认购结果: '写有效认购份额、确认比例、认购倍数、认购价格和最终募集规模。',
    上市: '写上市日期、交易所、交易代码、基金要素、资产概况及发行结果。',
  };
  return `${rules[record.progressType] || '围绕本次最新披露动作和可核验事实撰写。'}${expansion}`;
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

function validateBrief(value: string, record: BriefMaterial) {
  const length = Array.from(value.replace(/\s/g, '')).length;
  const minimum = record.progressType === '申报' && record.files.length === 0 ? 80 : 180;
  if (length < minimum || length > 400) throw new Error('invalid_length');
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
