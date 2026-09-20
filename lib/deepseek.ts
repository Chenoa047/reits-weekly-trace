import { preserveBriefUsage } from './brief-failure.ts';

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

export const BRIEF_RULES_VERSION = '2026-09-20-v4';

export type DeepSeekBriefResult = {
  brief: string;
  evidence: BriefEvidence[];
  inputTokens: number;
  outputTokens: number;
};

export type BriefEvidence = {
  fileUrl: string;
  page: number;
  claim: string;
  quote: string;
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
        reasoning: { effort: 'none' },
        temperature: 0.2,
        max_output_tokens: 6400,
        text: {
          format: {
            type: 'json_schema',
            name: 'reits_brief',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['brief', 'evidence'],
              properties: {
                brief: { type: 'string' },
                evidence: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['claim', 'fileIndex', 'quote'],
                    properties: {
                      claim: { type: 'string' },
                      fileIndex: { type: 'integer', minimum: 1 },
                      quote: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        instructions: buildInstructions(record),
        input: buildMaterial(record),
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(classifyDeepSeekError(response.status));
    const data = (await response.json()) as DeepSeekResponse;
    const inputTokens = numberValue(data.usage?.input_tokens);
    const outputTokens = numberValue(data.usage?.output_tokens);
    if (data.status === 'incomplete' || data.incomplete_details)
      throw preserveBriefUsage(
        new Error(
          data.incomplete_details?.reason === 'max_output_tokens'
            ? 'incomplete_max_output_tokens'
            : data.incomplete_details?.reason === 'content_filter'
              ? 'incomplete_content_filter'
              : 'incomplete_response',
        ),
        inputTokens,
        outputTokens,
      );
    try {
      const { brief, evidence } = parseBriefResponse(
        extractOutputText(data),
        record,
      );
      validateBrief(brief, record);
      return { brief, evidence, inputTokens, outputTokens };
    } catch (error) {
      throw preserveBriefUsage(error, inputTokens, outputTokens);
    }
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
  return (
    force ||
    !existing ||
    existing.briefRulesVersion !== BRIEF_RULES_VERSION ||
    sourceSignature(existing) !== sourceSignature(incoming) ||
    !isBriefDisplayable(existing.brief, incoming.progressType)
  );
}

function buildInstructions(record: BriefMaterial) {
  return `你是公募REITs行业周报撰写助手。只依据用户提供的交易所页面、公告和文件摘录撰写一段中文简报正文，不得调用外部知识。

通用规则：
1. 模仿用户提供的《简报示例》：标题由系统另行生成，你只写正文。正文使用金融专业书面语，客观、紧凑、单段呈现，不分点、不写小标题、不使用感叹号。不要写评价、意义、展望或空泛总结。
2. 第一句只交代本次事件，顺序固定为“日期—交易所—项目简称—本次动作或状态”。第一句不得夹带底层资产、估值、发行数据或历史进度。后续句子再写该阶段允许披露的核心事实。
3. 正文使用项目简称，不重复基金全称；不写“项目申报类型为首次发售”“资产类型为基础设施”“交易所项目动态信息显示”“项目发起人即”等机械字段，不写基金管理人、专项计划名称或与本次事件无关的流程回顾。
4. 每个事实只能来自下方“允许使用的原文件摘录”。项目动态页只可确认本次进度、交易所、日期；仅“申报”阶段还可使用项目动态页披露的原始权益人。不得依据文件名推断正文，不得使用外部知识，不得补齐材料中没有的信息。
5. 第一事实句之后的每个完整句子都必须提供证据。evidence.claim必须逐字复制该完整句子（可不含末尾句号），不能只截取句中一小段；evidence.quote必须逐字复制同一页原文件中的连续原文。一个句子引用多个文件时，为同一claim分别提供多条证据。
6. 不同文件的数据冲突时写明“披露文件数据存在差异，待核验”，不得自行选择、拼接或修正。金额、比例、面积、数量、日期、期限、代码等数字必须由原文直接支持，计算值只有在公告明确给出或可由同一句列明的数字直接计算时才能写。
7. 申报且无附件时只写状态及项目动态页披露的原始权益人，不写底层资产、估值或发行安排，不反复说明“尚未披露”。材料不足时允许只写一句。
8. 反馈/问询只概括监管关注的大类主题，不逐项罗列问题；回复反馈优先写回复文件明确披露的估值参数、评估基准日和评估值变化，再概括其他回复。文件没有变化数据时不得硬写估值变化。
9. 首发与扩募是项目属性，不是进度。扩募项目正文必须明确“扩募”，且资产部分只写本次新增资产。
10. 简报正文不输出标题、说明、引用列表、页码或Markdown。整个回答只输出JSON对象：{"brief":"简报正文","evidence":[{"claim":"简报中的一个完整事实句","fileIndex":1,"quote":"原文件同一页中的连续原文"}]}。fileIndex从下方文件1开始。申报阶段无附件时evidence为空数组。

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
    申报: '第一句写“日期，交易所网站显示，项目简称项目状态为‘已申报’”；项目动态页披露原始权益人时可在同句末尾写明。不得呈现或引用其他文件，不写底层资产。',
    受理: '第一句写“日期，交易所网站显示，项目简称项目状态为‘已受理’”。后续只依据最新招募说明书，依次写原始权益人、底层资产名称与位置、文件明确披露的少量核心参数。',
    '反馈/问询':
      '第一句写日期、交易所、项目简称及“获反馈”或“获问询”。后续只能依据交易所出具的反馈意见或问询函，概括主要关注主题和少量其他意见，不使用招募说明书补写资产介绍。',
    回复反馈: '第一句写日期、交易所、项目简称及“就反馈意见/审核问询函进行了答复”。后续以原始权益人的回复文件为事实来源，优先写文件明确披露的关键参数或估值变化，再概括其他主要回复；交易所原函仅用于说明问题背景。',
    注册生效: '第一句写日期、交易所、项目简称及状态变更为“注册生效”。后续只依据最新招募说明书写本次资产名称、位置和核心概况；只有最新招募说明书明确列示前后数据时才写估值变化。',
    询价: '第一句写日期、交易所、项目简称及“发布询价公告”。后续以询价公告为主，依次写询价区间、询价时间、募集期等公告明确披露的核心安排；仅当询价公告没有资产介绍时，才可用最新招募说明书补充底层资产。',
    发售: '第一句写日期、交易所、项目简称及“发布基金份额发售公告”。后续以发售公告为主，依次写发售日期、认购价格、份额与配售结构、募集规模；仅在公告没有资产介绍时用最新招募说明书补充底层资产。',
    认购结果: '第一句写日期、交易所、项目简称及“披露认购申请确认比例结果”。后续以认购结果公告为主，写各类投资者有效认购数量、确认比例或认购倍数及最终募集规模；仅在公告缺少必要项目背景时用最新招募说明书补充。',
    上市: '第一句写日期、交易所、项目简称及“正式上市”。后续以上市交易提示性公告为主，写交易代码、运作方式、期限、份额、发行价格和募集规模；需要补充时只能使用最新招募说明书、基金份额发售公告和认购申请确认比例结果公告。',
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

export function parseBriefResponse(raw: string, record: BriefMaterial) {
  let parsed: { brief?: unknown; evidence?: unknown };
  try {
    parsed = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    return { brief: canonicalBrief(record), evidence: [] };
  }
  if (typeof parsed.brief !== 'string' || !Array.isArray(parsed.evidence))
    return { brief: canonicalBrief(record), evidence: [] };
  if (record.progressType === '申报')
    return { brief: canonicalBrief(record), evidence: [] };

  const modelSentences = normalizeBrief(parsed.brief)
    .split('。')
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const detailSentences = modelSentences.slice(1);
  const candidateEvidence: BriefEvidence[] = [];
  for (const item of parsed.evidence) {
    if (
      !item ||
      !Number.isInteger(item.fileIndex) ||
      typeof item.claim !== 'string' ||
      item.claim.length < 6 ||
      item.claim.length > 240 ||
      typeof item.quote !== 'string' ||
      item.quote.length < 8 ||
      item.quote.length > 240
    )
      continue;
    const claim = normalizeClaim(item.claim);
    if (!detailSentences.includes(claim)) continue;
    const file = record.files[item.fileIndex - 1];
    if (!file?.content) continue;
    const page = findEvidencePage(file.content, item.quote);
    if (!page) continue;
    candidateEvidence.push({
      fileUrl: file.url,
      page,
      claim,
      quote: item.quote.trim(),
    });
  }

  const safeSentences = detailSentences.filter((sentence) => {
    const matches = candidateEvidence.filter(
      (item) => normalizeClaim(item.claim) === sentence,
    );
    if (!matches.length) return false;
    const quotes = matches
      .map((item) => item.quote)
      .join(' ')
      .replace(/[,，\s]/g, '');
    const numbers =
      sentence.replace(/[,，\s]/g, '').match(/\d+(?:\.\d+)?/g) || [];
    return numbers.every((number) => quotes.includes(number));
  });
  const opening = canonicalBriefOpening(record);
  const maximum = record.progressType === '反馈/问询' ? 280 : 400;
  const keptSentences: string[] = [];
  for (const sentence of safeSentences) {
    const next = `${opening}。${[...keptSentences, sentence].join('。')}。`;
    if (Array.from(next.replace(/\s/g, '')).length <= maximum)
      keptSentences.push(sentence);
  }
  const kept = new Set(keptSentences);
  const evidence = candidateEvidence.filter((item) => kept.has(item.claim));
  const brief = `${opening}${keptSentences.length ? `。${keptSentences.join('。')}` : ''}。`;
  return { brief, evidence };
}

export function canonicalBrief(record: BriefMaterial) {
  return `${canonicalBriefOpening(record)}。`;
}

export function canonicalBriefOpening(record: BriefMaterial) {
  const [, month, day] = record.updateDate.split('-');
  const date = `${Number(month)}月${Number(day)}日`;
  const expansion = record.offeringType === '扩募' ? '扩募' : '';
  const prefix = `${date}，${record.exchange}网站显示，${record.shortName}${expansion}项目`;
  const actions: Record<string, string> = {
    申报: '状态为“已申报”',
    受理: '状态为“已受理”',
    '反馈/问询': record.exchange === '深交所' ? '获审核问询' : '获反馈',
    回复反馈:
      record.exchange === '深交所'
        ? '就审核问询函进行了答复'
        : '就反馈意见进行了答复',
    注册生效: '状态变更为“注册生效”',
    询价: '发布基金份额询价公告',
    发售: '发布基金份额发售公告',
    认购结果: '披露认购申请确认比例结果',
    上市: '正式上市',
  };
  const originator =
    record.progressType === '申报' && record.originator
      ? `，原始权益人为${record.originator.replace(/[;；]/g, '、')}`
      : '';
  return `${prefix}${actions[record.progressType] || `状态更新为“${record.status}”`}${originator}`;
}

function normalizeClaim(value: string) {
  return value
    .trim()
    .replace(/[。；;]$/, '')
    .trim();
}

function findEvidencePage(content: string, quote: string) {
  const normalizedQuote = quote.replace(/\s/g, '');
  for (const part of content.split(/(?=\[第\d+页\])/)) {
    const page = part.match(/^\[第(\d+)页\]/)?.[1];
    if (page && part.replace(/\s/g, '').includes(normalizedQuote))
      return Number(page);
  }
  return 0;
}

export function isCompleteBrief(value: string) {
  return value.trim().endsWith('。');
}

export function isBriefDisplayable(value: string, stage: string) {
  const length = Array.from(value.replace(/\s/g, '')).length;
  return isCompleteBrief(value) && (stage !== '反馈/问询' || length <= 280);
}

export function isCurrentBriefDisplayable(
  value: string,
  stage: string,
  version?: string,
) {
  return version === BRIEF_RULES_VERSION && isBriefDisplayable(value, stage);
}

export function validateBrief(value: string, record: BriefMaterial) {
  if (!isCompleteBrief(value)) throw new Error('incomplete_sentence');
  validateOpeningSentence(value, record);
  const length = Array.from(value.replace(/\s/g, '')).length;
  const minimum = 25;
  const maximum = record.progressType === '反馈/问询' ? 280 : 400;
  if (length < minimum || length > maximum) throw new Error('invalid_length');
  if (/[!！]/.test(value)) throw new Error('invalid_format');
  if (/(^|\s)[-•·]\s|(^|\s)\d+[.、]\s/.test(value))
    throw new Error('invalid_format');
  if (/附件正文尚未解析|无法核验|未成功读取|根据公开资料/.test(value))
    throw new Error('invalid_meta_content');
  if (record.offeringType === '扩募' && !value.includes('扩募'))
    throw new Error('missing_expansion_label');
  if (
    record.progressType === '反馈/问询' &&
    /(?:^|[。；])(?:[一二三四五六七八九十]+、|\d+[、.])/.test(value)
  )
    throw new Error('invalid_format');
  validateNumbers(value, record);
}

function validateOpeningSentence(value: string, record: BriefMaterial) {
  const opening = value.split('。', 1)[0];
  const [, month, day] = record.updateDate.split('-');
  const date = `${Number(month)}月${Number(day)}日`;
  if (
    !opening.startsWith(`${date}，`) ||
    !opening.includes(record.exchange) ||
    !opening.includes(record.shortName)
  )
    throw new Error('invalid_opening');
  const markers: Record<string, RegExp> = {
    申报: /已申报/,
    受理: /已受理/,
    '反馈/问询': /反馈|问询/,
    回复反馈: /答复|回复/,
    注册生效: /注册生效/,
    询价: /询价公告/,
    发售: /发售公告/,
    认购结果: /认购申请确认比例|认购结果/,
    上市: /上市/,
  };
  if (!(markers[record.progressType] || /./).test(opening))
    throw new Error('invalid_opening');
  if (
    record.progressType !== '申报' &&
    /(?:原始权益人|底层资产|评估值|出租率|建筑面积|募集规模|交易代码|存续期限|认购价格|发行价格|询价区间|发售时间|募集期|亿元|万元|平方米|万平方米|元\/份|份|倍|%|％|MW|千瓦时)/.test(
      opening,
    )
  )
    throw new Error('opening_contains_details');
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
  incomplete_details?: {
    reason?: 'max_output_tokens' | 'content_filter';
  } | null;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
