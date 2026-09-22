import { briefFailureUsage, preserveBriefUsage } from './brief-failure.ts';

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

export const BRIEF_RULES_VERSION = '2026-09-20-v10';
const INQUIRY_BRIEF_RULES_VERSION = '2026-09-22-inquiry-v1';
const FEEDBACK_BRIEF_RULES_VERSION = '2026-09-22-feedback-v2';
const OFFERING_BRIEF_RULES_VERSION = '2026-09-22-offering-v1';

export function briefRulesVersionFor(stage: string) {
  if (stage === '询价') return INQUIRY_BRIEF_RULES_VERSION;
  if (stage === '反馈/问询') return FEEDBACK_BRIEF_RULES_VERSION;
  if (stage === '发售') return OFFERING_BRIEF_RULES_VERSION;
  return BRIEF_RULES_VERSION;
}

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
  if (!apiKey) {
    const fallback = buildExchangeQuestionFallback(record);
    if (fallback) return { ...fallback, inputTokens: 0, outputTokens: 0 };
    throw new Error('not_configured');
  }

  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await requestDeepSeekBrief(record, apiKey, attempt === 1);
      return {
        ...result,
        inputTokens: inputTokens + result.inputTokens,
        outputTokens: outputTokens + result.outputTokens,
      };
    } catch (error) {
      const usage = briefFailureUsage(error);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      if (attempt === 0 && isRetryableBriefFailure(error)) continue;
      const fallback = buildExchangeQuestionFallback(record);
      if (fallback)
        return { ...fallback, inputTokens, outputTokens };
      throw preserveBriefUsage(
        new Error(error instanceof Error ? error.message : 'brief_quality_error'),
        inputTokens,
        outputTokens,
      );
    }
  }
  throw new Error('brief_quality_error');
}

async function requestDeepSeekBrief(
  record: BriefMaterial,
  apiKey: string,
  compact: boolean,
): Promise<DeepSeekBriefResult> {
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
        instructions: buildInstructions(record, compact),
        input: buildMaterial(record, compact),
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
      validateBrief(brief, record, evidence);
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

function isRetryableBriefFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /no_verified_detail|incomplete_max_output_tokens|incomplete_response|timeout|provider_unavailable|rate_limited|request_failed|invalid_|missing_evidence|partial_evidence|evidence_number_mismatch|unsupported_number|incomplete_sentence/.test(
    message,
  );
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
    existing.briefRulesVersion !== briefRulesVersionFor(incoming.progressType) ||
    sourceSignature(existing) !== sourceSignature(incoming) ||
    !isBriefDisplayable(existing.brief, incoming.progressType)
  );
}

function buildInstructions(record: BriefMaterial, compact = false) {
  return `你是公募REITs行业周报撰写助手。只依据用户提供的交易所页面、公告和文件摘录撰写一段中文简报正文，不得调用外部知识。

通用规则：
1. 模仿用户提供的《简报示例》：标题由系统另行生成，你只写正文。正文使用金融专业书面语，客观、紧凑、单段呈现，不分点、不写小标题、不使用感叹号。不要写评价、意义、展望或空泛总结。
2. 第一句只交代本次事件，顺序固定为“日期—交易所—项目简称—本次动作或状态”。第一句不得夹带底层资产、估值、发行数据或历史进度。后续句子再写该阶段允许披露的核心事实。
3. 正文使用项目简称，不重复基金全称；不写“项目申报类型为首次发售”“资产类型为基础设施”“交易所项目动态信息显示”“项目发起人即”等机械字段，不写基金管理人、专项计划名称或与本次事件无关的流程回顾。
4. 每个事实只能来自下方“允许使用的原文件摘录”。项目动态页只可确认本次进度、交易所、日期；仅“申报”阶段还可使用项目动态页披露的原始权益人。不得依据文件名推断正文，不得使用外部知识，不得补齐材料中没有的信息。
5. 第一事实句之后的每个完整句子都必须提供证据。evidence.claim必须逐字复制该完整句子（可不含末尾句号），不能只截取句中一小段；evidence.quote必须逐字复制同一页原文件中的连续原文。一个句子引用多个文件时，为同一claim分别提供多条证据。
6. 不同文件的数据冲突时写明“披露文件数据存在差异，待核验”，不得自行选择、拼接或修正。金额、比例、面积、数量、日期、期限、代码等数字必须由原文直接支持；计算值仅在同一允许使用的原文件中有同次发行、口径一致且可逐项核验的基础数字时才能写，并为计算句分别引用所用数字的原文。
7. 申报且无附件时只写状态及项目动态页披露的原始权益人，不写底层资产、估值或发行安排，不反复说明“尚未披露”。材料不足时允许只写一句。
8. 严格区分文件方向：反馈/问询的核心依据只能是交易所发给原始权益人或申报方的反馈意见/审核问询函；回复反馈的全部扩展事实只能来自原始权益人或申报方提交给交易所的答复/回复PDF，严禁把交易所原函当作回复内容。反馈/问询只概括监管关注的大类主题，不逐项罗列问题；回复反馈先概括回复文件披露的估值参数调整类别，再写整体评估值相对申报时点的金额和比例变化，最后概括其他回复事项。文件没有变化数据时不得硬写估值变化。
9. 首发与扩募是项目属性，不是进度。扩募项目正文必须明确“扩募”，且资产部分只写本次新增资产。
10. 简报正文不输出标题、说明、引用列表、页码或Markdown。整个回答只输出JSON对象：{"brief":"简报正文","evidence":[{"claim":"简报中的一个完整事实句","fileIndex":1,"quote":"原文件同一页中的连续原文"}]}。fileIndex从下方文件1开始。申报阶段无附件时evidence为空数组。

本条阶段规则：${stageInstruction(record)}${
    compact
      ? record.progressType === '询价'
        ? '\n本次为精简重试：保持询价六类信息的规定顺序；可合并同类事实，但不得省略公告已披露的关键份额和比例；每条quote不超过120字。'
        : record.progressType === '发售'
          ? '\n本次为精简重试：保持发售六类信息的规定顺序；可合并同类事实，但不得省略公告已披露的关键份额和比例；每条quote不超过120字。'
        : '\n本次为精简重试：最多写3个扩展事实句；每句只表达一个主题；evidence最多4条，每条quote不超过120字；不要复述问题全文。'
      : ''
  }`;
}

function buildMaterial(record: BriefMaterial, compact = false) {
  const compactLimit = Math.floor(18_000 / Math.max(record.files.length, 1));
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
正文摘录：${
          file.content
            ? compact
              ? file.content.slice(0, compactLimit)
              : file.content
            : '未成功读取，不得引用该文件中的事实'
        }`,
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
      '第一句写日期、交易所、项目简称及“获反馈”或“获问询”。随后只用一个完整句子概括交易所原函中“一、二、三……”等一级大标题涉及的主要方面，到“等方面展开”或同义表述即止；绝对不要再接“包括……”列举细分问题，也不要另起一句列举大标题下的小标题、具体问题或案例。接着仅依据原函最后一大项“其他反馈意见”“其他反馈问题”或“其他问询问题”，用“其余还包括……”概括其中少量主要事项；不得从前面各大项抽取细分问题充作“其余”。简报结尾依据该项目最新招募说明书，介绍原始权益人及本次底层资产的名称、位置和少量基本规模信息；资产介绍只引用招募说明书，不能引用交易所原函、回复文件或自行补写。缺少对应原文时不补写。',
    回复反馈: '第一句写日期、交易所、项目简称及“就反馈意见/审核问询函进行了答复”。第一句之后的全部事实只能依据原始权益人或申报方提交给交易所的答复/回复PDF，不能引用交易所发出的反馈意见或审核问询函。先概括调整涉及的估值参数类别，不展开每项参数调整前后的具体数值；随后只写调整后不动产项目整体评估值相对申报时点的金额变化和整体变动比例；最后概括业务参与人资质及履约能力、历史合规手续、土地用途、关联方租赁、运营管理费、治理机制、回收资金安排等回复文件实际涉及的其他主题。',
    注册生效: '第一句写日期、交易所、项目简称及状态变更为“注册生效”。后续只依据最新招募说明书写本次资产名称、位置和核心概况；只有最新招募说明书明确列示前后数据时才写估值变化。',
    询价: '第一句严格写“X月X日，X交易所网站显示，XXREIT发布基金份额询价公告”（扩募项目须在简称后写明扩募）。随后按顺序写：①证监会准予募集注册的文件编号、基金代码；②询价区间、询价日及具体时间、预计基金份额募集期；③本次发售份额总额、战略配售初始份额及占比，并写明原始权益人及其关联方和其他战略投资者的份额及占比，再写网下初始份额及占比、公众投资者认购初始份额及占比；④按询价区间上下限与本次发售总份额计算的募集资金总额区间，注明为按上下限计算，单位和小数精度须核对；⑤最后仅依据最新招募说明书介绍原始权益人及本次底层资产的名称、位置和少量基本规模信息。发行数据与注册文号、基金代码只能引用询价公告；资产数据只能引用最新招募说明书。公告未披露的字段跳过，不补写、不改变其他字段顺序。',
    发售: '第一句严格写“X月X日，X交易所网站显示，XXREIT发布基金份额发售公告”（扩募项目须在简称后写明扩募）。随后按顺序写：①证监会准予募集注册的文件编号、基金代码；②发售认购价格、基金运作方式、存续期限、本次发售份额总额；③战略配售初始份额及占比，并写明原始权益人及其关联方和其他战略投资者的份额及占比，再写网下初始份额及占比、公众投资者认购初始份额及占比；④按认购价格乘以本次发售份额总额计算募集资金总额，写明“按认购价格和发售份额总额计算”，并核对单位和小数精度；⑤最后仅依据最新招募说明书介绍原始权益人及本次底层资产的名称、位置和少量基本规模信息。注册文号、基金代码、发行安排和份额数据只能引用发售公告；资产数据只能引用最新招募说明书。公告未披露的字段跳过，不补写、不改变其他字段顺序。',
    认购结果: '第一句写日期、交易所、项目简称及“发布认购申请确认比例的公告”。后续严格按以下顺序写，公告披露的字段不得遗漏：基金份额总额、战略配售初始发售份额、网下发售初始发售份额、公众发售初始发售份额；网下投资者有效认购份额总数及配售比例；公众投资者有效认购基金份额数量、有效认购申请确认比例及认购倍数；基金份额认购价格、募集基金份额总额及最终募集规模。缺失字段直接跳过，不改变其余字段顺序。最终募集规模未直接列示时，仅可依据同一认购结果公告明确披露的“认购价格×募集基金份额总额”计算，并写明“因此，最终募集规模为”。',
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
    if (!isAllowedEvidenceSource(record.progressType, claim, file, item.quote))
      continue;
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
    if (
      record.progressType === '回复反馈' &&
      isGranularReplyParameterChange(sentence)
    )
      return false;
    const matches = candidateEvidence.filter(
      (item) => normalizeClaim(item.claim) === sentence,
    );
    if (!matches.length) return false;
    if (record.progressType === '反馈/问询' &&
        !isOtherFeedbackClaim(sentence) &&
        !isFeedbackMainSummary(sentence) &&
        !matches.some((item) => record.files.some((file) =>
          file.kind === '招募说明书' && file.url === item.fileUrl)))
      return false;
    const quotes = matches
      .map((item) => item.quote)
      .join(' ')
      .normalize('NFKC')
      .replace(/[,\s]/g, '');
    const numbers =
      sentence
        .normalize('NFKC')
        .replace(/[,\s]/g, '')
        .match(/\d+(?:\.\d+)?/g) || [];
    const unsupported = numbers.filter((number) => !quotes.includes(number));
    if (record.progressType === '发售' && /募集资金总额/.test(sentence))
      return supportsDerivedOfferingScale(sentence, quotes, unsupported);
    return (
      !unsupported.length ||
      (record.progressType === '认购结果' &&
        supportsDerivedFinalScale(sentence, quotes, unsupported)) ||
      (record.progressType === '询价' &&
        supportsDerivedInquiryScale(sentence, quotes, unsupported))
    );
  });
  const orderedSentences = orderDetailSentences(
    safeSentences,
    record.progressType,
  );
  const opening = canonicalBriefOpening(record);
  const maximum = briefMaximumLength(record.progressType);
  const keptSentences: string[] = [];
  for (const sentence of orderedSentences) {
    if (record.progressType === '反馈/问询' &&
        isFeedbackMainSummary(sentence) &&
        keptSentences.some(isFeedbackMainSummary))
      continue;
    const next = `${opening}。${[...keptSentences, sentence].join('。')}。`;
    if (Array.from(next.replace(/\s/g, '')).length <= maximum)
      keptSentences.push(sentence);
  }
  const evidence = keptSentences.flatMap((sentence) =>
    candidateEvidence.filter((item) => item.claim === sentence),
  );
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
  const subject =
    (record.progressType === '询价' || record.progressType === '发售') &&
    record.offeringType !== '扩募'
      ? record.shortName
      : `${record.shortName}${expansion}项目`;
  const prefix = `${date}，${record.exchange}网站显示，${subject}`;
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
    认购结果: '发布认购申请确认比例的公告',
    上市: '正式上市',
  };
  const originator =
    record.progressType === '申报' && record.originator
      ? `，原始权益人为${record.originator.replace(/[;；]/g, '、')}`
      : '';
  return `${prefix}${actions[record.progressType] || `状态更新为“${record.status}”`}${originator}`;
}

export function buildExchangeQuestionFallback(record: BriefMaterial) {
  if (record.progressType !== '反馈/问询') return null;
  const file = record.files.find(
    (item) =>
      (item.kind === '反馈意见' || item.kind === '问询函') &&
      item.issuerRole !== '原始权益人' &&
      item.content,
  );
  if (!file?.content) return null;

  const definitions = [
    {
      label: '业务参与人资质及履职能力',
      patterns: [/^(?:关于)?业务参与人.{0,8}资质及履职能力/, /^(?:关于)?业务参与人.{0,8}履职能力/],
    },
    {
      label: '不动产项目合规性',
      patterns: [/^(?:关于)?(?:不动产|基础设施项目).{0,8}合规(?:情况|性)?/],
    },
    {
      label: '项目经营与财务情况',
      patterns: [/^(?:关于)?项目经营.{0,6}财务(?:情况)?/],
    },
    {
      label: '资产评估与估值合理性',
      patterns: [/^(?:关于)?资产评估/, /^(?:关于)?估值合理性/, /^(?:关于)?不动产估值/],
    },
    {
      label: '基金运作与治理机制',
      patterns: [/^(?:关于)?基金运作.{0,6}治理(?:机制)?/],
    },
  ] as const;
  const topics = definitions.flatMap((definition) => {
    const match = findQuestionTopic(file.content!, definition.patterns);
    return match ? [{ ...definition, ...match }] : [];
  });
  if (!topics.length) return null;

  const documentName = file.kind === '问询函' ? '审核问询函' : '反馈意见';
  const claim = `${documentName}主要围绕${topics.map((topic) => topic.label).join('、')}等方面展开，要求进一步补充说明或充分披露`;
  const details = [claim];
  const evidence: BriefEvidence[] = topics.map((topic) => ({
    fileUrl: file.url,
    page: topic.page,
    claim,
    quote: topic.quote,
  }));
  const other = summarizeOtherFeedback(file.content);
  if (other &&
      Array.from(`${canonicalBriefOpening(record)}。${[...details, other.claim].join('。')}。`.replace(/\s/g, '')).length <= briefMaximumLength(record.progressType)) {
    details.push(other.claim);
    evidence.push(...other.evidence.map((item) => ({ ...item, fileUrl: file.url })));
  }
  const prospectus = record.files
    .filter((item) => item.kind === '招募说明书' && item.content)
    .sort((left, right) => (right.publishedAt || '').localeCompare(left.publishedAt || ''))[0];
  if (prospectus?.content) {
    for (const pattern of [
      /原始权益人\s*(?:为|是|：|:)\s*([^。；\n]{2,80})[。；]/,
      /底层资产\s*(?:为|包括|：|:)\s*([^。；\n]{2,80})[。；]/,
    ]) {
      const fact = findProspectusFact(prospectus.content, pattern);
      if (!fact) continue;
      if (details.some((item) => item.includes(fact.claim))) continue;
      const next = `${canonicalBriefOpening(record)}。${[...details, fact.claim].join('。')}。`;
      if (Array.from(next.replace(/\s/g, '')).length > briefMaximumLength(record.progressType))
        continue;
      details.push(fact.claim);
      evidence.push({ fileUrl: prospectus.url, ...fact });
    }
  }
  const brief = `${canonicalBriefOpening(record)}。${details.join('。')}。`;
  validateBrief(brief, record, evidence);
  return { brief, evidence };
}

function findQuestionTopic(content: string, patterns: readonly RegExp[]) {
  for (const pageText of content.split(/(?=\[第\d+页\])/).reverse()) {
    const page = Number(pageText.match(/^\[第(\d+)页\]/)?.[1]);
    if (!page) continue;
    for (const heading of pageText.matchAll(/[一二三四五六七八九十]{1,3}[、.．]\s*([^。；\n]{2,55})/g)) {
      const title = heading[1].normalize('NFKC').replace(/\s/g, '');
      if (patterns.some((pattern) => pattern.test(title))) {
        return { page, quote: heading[0].trim() };
      }
    }
  }
  return null;
}

function summarizeOtherFeedback(content: string) {
  const headings = [...content.matchAll(/[一二三四五六七八九十]{1,3}[、.．]\s*其他(?:反馈意见|反馈问题|问询问题|问询事项)/g)];
  const heading = headings.at(-1);
  if (!heading || heading.index === undefined) return null;
  const tail = content.slice(heading.index + heading[0].length);
  const themes = [
    { label: '扩募条件', pattern: /扩募条件/ },
    { label: '程序合规', pattern: /程序合规|合规程序/ },
    { label: '信息披露', pattern: /信息披露/ },
    { label: '资金使用', pattern: /资金使用|回收资金/ },
    { label: '账户安排', pattern: /共管账户|账户安排/ },
    { label: '基金收益', pattern: /基金收益|收益分配/ },
    { label: '项目投保', pattern: /资产投保|项目投保/ },
  ];
  const found = themes.flatMap(({ label, pattern }) => {
    const match = pattern.exec(tail);
    if (!match) return [];
    const page = pageAtOffset(content, heading.index! + heading[0].length + match.index);
    return page ? [{ label, page, quote: match[0], index: match.index }] : [];
  }).sort((left, right) => left.index - right.index).slice(0, 3);
  if (!found.length) return null;
  const claim = `其余还包括${found.map((item) => item.label).join('、')}等其他反馈意见`;
  return {
    claim,
    evidence: found.map(({ page, quote }) => ({ page, quote, claim })),
  };
}

function pageAtOffset(content: string, offset: number) {
  return Number([...content.slice(0, offset).matchAll(/\[第(\d+)页\]/g)].at(-1)?.[1] || 0);
}

function findProspectusFact(content: string, pattern: RegExp) {
  for (const pageText of content.split(/(?=\[第\d+页\])/)) {
    const page = Number(pageText.match(/^\[第(\d+)页\]/)?.[1]);
    if (!page) continue;
    const match = pattern.exec(pageText);
    if (match) {
      const quote = match[0].trim();
      return { page, quote, claim: quote.replace(/[。；]$/, '').replace(/\s+/g, '') };
    }
  }
  return null;
}

function normalizeClaim(value: string) {
  return value
    .trim()
    .replace(/[。；;]$/, '')
    .trim();
}

function containsNumber(value: string) {
  return /\d/.test(value.normalize('NFKC'));
}

function isAllowedEvidenceSource(
  stage: string,
  claim: string,
  file: BriefMaterial['files'][number],
  quote: string,
) {
  if (stage === '询价') {
    return (
      (file.kind === '询价' && !isAssetBackgroundSentence(claim)) ||
      (file.kind === '招募说明书' &&
        isAssetIntroductionSentence(claim) &&
        !/询价|募集|发售|配售|认购|基金代码|证监许可|注册批文|元\/份/.test(claim))
    );
  }
  if (stage === '发售') {
    return (
      (file.kind === '发售' && !isAssetBackgroundSentence(claim)) ||
      (file.kind === '招募说明书' &&
        isAssetIntroductionSentence(claim) &&
        !/询价|募集|发售|配售|认购|基金代码|证监许可|注册批文|运作方式|存续期限|元\/份/.test(claim))
    );
  }
  if (stage === '回复反馈') {
    return file.kind === '回复反馈' && file.issuerRole !== '交易所';
  }
  if (stage === '反馈/问询') {
    if (
      (file.kind === '反馈意见' || file.kind === '问询函') &&
      file.issuerRole !== '原始权益人'
    )
      return !/底层资产|项目位于|建筑面积|可供出租面积|占地面积|原始权益人为|项目原始权益人/.test(claim) &&
        (isOtherFeedbackClaim(claim)
          ? isQuoteInOtherFeedbackSection(file.content || '', quote)
          : isFeedbackMainSummary(claim) &&
            /[一二三四五六七八九十]{1,3}[、.．]\s*[^。；\n]{2,55}/.test(quote));
    return file.kind === '招募说明书' && isAssetIntroductionSentence(claim);
  }
  return true;
}

function isOtherFeedbackClaim(value: string) {
  return /其余还包括|此外还包括|其他反馈意见|其他反馈问题|其他问询问题/.test(value);
}

function isFeedbackMainSummary(value: string) {
  return /(?:反馈意见|问询函).{0,12}(?:主要|重点)(?:围绕|关注|涉及)/.test(value) &&
    !/包括|具体|其中|例如|分别|逐项/.test(value);
}

function isQuoteInOtherFeedbackSection(content: string, quote: string) {
  const normalized = content.normalize('NFKC').replace(/\s/g, '');
  const headings = [...normalized.matchAll(/[一二三四五六七八九十]{1,3}[、.]其他(?:反馈意见|反馈问题|问询问题|问询事项)/g)];
  const lastHeading = headings.at(-1);
  const quoteAt = normalized.lastIndexOf(quote.normalize('NFKC').replace(/\s/g, ''));
  return Boolean(lastHeading && quoteAt >= (lastHeading.index || 0));
}

function isAssetIntroductionSentence(value: string) {
  return /原始权益人|底层资产|基础设施项目|不动产项目|项目位于|建筑面积|可供出租面积|占地面积/.test(
    value,
  );
}

function isAssetBackgroundSentence(value: string) {
  return /底层资产|项目位于|建筑面积|可供出租面积|占地面积|原始权益人为|项目原始权益人为/.test(value);
}

function supportsDerivedFinalScale(
  sentence: string,
  quotes: string,
  unsupported: string[],
) {
  if (unsupported.length !== 1) return false;
  const normalizedSentence = sentence.normalize('NFKC').replace(/[,\s]/g, '');
  const price = Number(
    normalizedSentence.match(/认购价格(?:为)?(\d+(?:\.\d+)?)元\/份/)?.[1],
  );
  const shares = Number(
    normalizedSentence.match(/募集(?:的)?基金份额总额(?:为)?(\d+(?:\.\d+)?)亿份/)?.[1],
  );
  const scaleText = normalizedSentence.match(
    /最终募集规模(?:将)?(?:为)?(\d+(?:\.\d+)?)亿元/,
  )?.[1];
  const scale = Number(scaleText);
  if (!price || !shares || !scaleText || !Number.isFinite(scale)) return false;
  if (!quotes.includes(String(price)) || !quotes.includes(String(shares))) return false;
  const decimals = scaleText.split('.')[1]?.length || 0;
  return (
    unsupported[0] === scaleText &&
    Math.abs(price * shares - scale) < 0.5 * 10 ** -decimals
  );
}

function supportsDerivedInquiryScale(
  sentence: string,
  quotes: string,
  unsupported: string[],
) {
  if (unsupported.length !== 2 || !/按询价区间上下限计算/.test(sentence))
    return false;
  const prices = [...quotes.matchAll(/(\d+(?:\.\d+)?)元\/份/g)].map((match) =>
    Number(match[1]),
  );
  const shares = quotes.match(
    /(?:发售份额总额|发售总份额|募集基金份额总额)(?:为)?(\d+(?:\.\d+)?)(亿|万)份/,
  );
  const scale = sentence.normalize('NFKC').replace(/[,\s]/g, '').match(
    /募集资金总额(?:为|约为)?(\d+(?:\.\d+)?)(亿|万)元(?:至|到|-|—|~)(\d+(?:\.\d+)?)(亿|万)元/,
  );
  if (prices.length !== 2 || !shares || !scale) return false;
  const totalShares = Number(shares[1]) * (shares[2] === '万' ? 1e-4 : 1);
  const expected = prices.map((price) => price * totalShares).sort((a, b) => a - b);
  const actual = [1, 3].map((index) =>
    Number(scale[index]) * (scale[index + 1] === '万' ? 1e-4 : 1),
  );
  return (
    unsupported[0] === scale[1] &&
    unsupported[1] === scale[3] &&
    actual.every((value, index) => {
      const decimals = scale[index === 0 ? 1 : 3].split('.')[1]?.length || 0;
      const unit = scale[index === 0 ? 2 : 4] === '万' ? 1e-4 : 1;
      return Math.abs(value - expected[index]) < 0.5 * 10 ** -decimals * unit;
    })
  );
}

function supportsDerivedOfferingScale(
  sentence: string,
  quotes: string,
  unsupported: string[],
) {
  if (unsupported.length > 1 || !/按认购价格/.test(sentence) || !/计算/.test(sentence))
    return false;
  const prices = [...quotes.matchAll(/(\d+(?:\.\d+)?)元\/份/g)];
  const shares = quotes.match(
    /(?:发售份额总额|发售总份额|发售基金份额总额|份额总量)(?:为)?(\d+(?:\.\d+)?)(亿|万)份/,
  );
  const scale = sentence.normalize('NFKC').replace(/[,\s]/g, '').match(
    /募集资金总额(?:为|约为)?(\d+(?:\.\d+)?)(亿|万)元/,
  );
  if (prices.length !== 1 || !shares || !scale ||
      (unsupported.length === 1 && unsupported[0] !== scale[1]))
    return false;
  const expected = Number(prices[0][1]) * Number(shares[1]) *
    (shares[2] === '万' ? 1e-4 : 1);
  const unit = scale[2] === '万' ? 1e-4 : 1;
  const actual = Number(scale[1]) * unit;
  const decimals = scale[1].split('.')[1]?.length || 0;
  return Math.abs(actual - expected) < 0.5 * 10 ** -decimals * unit;
}

function isGranularReplyParameterChange(value: string) {
  return (
    containsNumber(value) &&
    /出租率|租金增长率|长期增长率|租金收缴率|收缴率|折现率/.test(value)
  );
}

function orderDetailSentences(sentences: string[], stage: string) {
  return sentences
    .map((sentence, index) => ({ sentence, index }))
    .sort((left, right) => {
      const rank =
        stageSentenceRank(left.sentence, stage) -
        stageSentenceRank(right.sentence, stage);
      return rank || left.index - right.index;
    })
    .map(({ sentence }) => sentence);
}

function briefMaximumLength(stage: string) {
  if (stage === '反馈/问询') return 450;
  if (stage === '询价' || stage === '发售') return 600;
  return 400;
}

function stageSentenceRank(sentence: string, stage: string) {
  if (stage === '反馈/问询') {
    if (/其余还包括|此外还包括|其他反馈意见|其他反馈问题|其他问询问题/.test(sentence))
      return 2;
    if (/原始权益人|底层资产|基础设施项目|项目位于|建筑面积|装机容量/.test(sentence) &&
        !/资质及履职能力/.test(sentence))
      return 3;
    return 1;
  }
  if (stage === '认购结果') {
    if (/认购价格|最终募集规模|募集规模/.test(sentence)) return 4;
    if (/初始发售份额|基金份额总额|募集基金份额总额/.test(sentence)) return 1;
    if (/网下投资者/.test(sentence) && /有效认购|配售比例/.test(sentence)) return 2;
    if (/公众投资者/.test(sentence) && /有效认购|确认比例|认购倍数/.test(sentence))
      return 3;
    return 5;
  }
  if (stage === '询价') {
    if (/证监许可|募集注册|基金代码/.test(sentence)) return 1;
    if (/询价区间|询价日|募集期|元\/份/.test(sentence) && !/按询价区间上下限计算/.test(sentence)) return 2;
    if (/战略配售|网下发售|公众投资者|初始份额|发售份额总额/.test(sentence)) return 3;
    if (/募集资金总额|募集资金规模|募集规模/.test(sentence)) return 4;
    if (/原始权益人|底层资产|基础设施项目|不动产项目|项目所在地|项目位于|建筑面积|装机容量/.test(sentence)) return 5;
    return 4;
  }
  if (stage === '发售') {
    if (/证监许可|募集注册|基金代码/.test(sentence)) return 1;
    if (/募集资金总额|募集规模/.test(sentence)) return 4;
    if (/战略配售|网下发售|公众投资者|初始份额/.test(sentence)) return 3;
    if (/认购价格|运作方式|存续期限|发售份额总额|发售总份额/.test(sentence)) return 2;
    if (/原始权益人|底层资产|基础设施项目|不动产项目|项目位于|建筑面积|装机容量/.test(sentence)) return 5;
    return 4;
  }
  if (stage === '回复反馈') {
    if (/估值参数|出租率|租金增长率|长期增长率|租金收缴率|收缴率|折现率/.test(sentence))
      return 1;
    if (/整体评估值|合计评估值|整体估值|评估值.*(?:下降|上升|变动)/.test(sentence))
      return 2;
    return 3;
  }
  return 1;
}

function findEvidencePage(content: string, quote: string) {
  const normalizedQuote = quote.normalize('NFKC').replace(/\s/g, '');
  for (const part of content.split(/(?=\[第\d+页\])/)) {
    const page = part.match(/^\[第(\d+)页\]/)?.[1];
    if (
      page &&
      part.normalize('NFKC').replace(/\s/g, '').includes(normalizedQuote)
    )
      return Number(page);
  }
  return 0;
}

export function isCompleteBrief(value: string) {
  return value.trim().endsWith('。');
}

export function isBriefDisplayable(value: string, stage: string) {
  const length = Array.from(value.replace(/\s/g, '')).length;
  return isCompleteBrief(value) && (stage !== '反馈/问询' || length <= briefMaximumLength(stage));
}

export function isCurrentBriefDisplayable(
  value: string,
  stage: string,
  version?: string,
) {
  return version === briefRulesVersionFor(stage) && isBriefDisplayable(value, stage);
}

export function validateBrief(
  value: string,
  record: BriefMaterial,
  evidence?: BriefEvidence[],
) {
  if (!isCompleteBrief(value)) throw new Error('incomplete_sentence');
  validateOpeningSentence(value, record);
  const length = Array.from(value.replace(/\s/g, '')).length;
  const minimum = 25;
  const maximum = briefMaximumLength(record.progressType);
  if (length < minimum || length > maximum) throw new Error('invalid_length');
  if (/[!！]/.test(value)) throw new Error('invalid_format');
  if (/(^|\s)[-•·]\s|(^|\s)\d+[.、]\s/.test(value))
    throw new Error('invalid_format');
  if (/附件正文尚未解析|无法核验|未成功读取|根据公开资料/.test(value))
    throw new Error('invalid_meta_content');
  if (record.offeringType === '扩募' && !value.includes('扩募'))
    throw new Error('missing_expansion_label');
  if (
    record.progressType !== '申报' &&
    evidence !== undefined &&
    (evidence.length === 0 || normalizeBrief(value) === canonicalBrief(record))
  )
    throw new Error('no_verified_detail');
  if (
    record.progressType === '反馈/问询' &&
    /(?:^|[。；])(?:[一二三四五六七八九十]+、|\d+[、.])/.test(value)
  )
    throw new Error('invalid_format');
  if (evidence === undefined) validateNumbers(value, record);
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
    /(?:原始权益人|底层资产|评估值|出租率|建筑面积|募集规模|交易代码|存续期限|认购价格|发行价格|询价区间|发售时间|募集期|亿元|万元|平方米|万平方米|元\/份|倍|%|％|MW|千瓦时)/.test(
      opening,
    )
  )
    throw new Error('opening_contains_details');
}

function validateNumbers(value: string, record: BriefMaterial) {
  const source =
    `${record.progressType === '申报' ? stripHtml(record.sourceHtml) : ''}\n${record.files.map((file) => file.content || '').join('\n')}`
      .normalize('NFKC')
      .replace(/[,\s]/g, '');
  const numbers =
    value.match(/\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:亿|万)?元|\d+(?:\.\d+)?倍/g) ||
    [];
  for (const number of numbers) {
    if (!source.includes(number.normalize('NFKC').replace(/[,\s]/g, '')))
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
