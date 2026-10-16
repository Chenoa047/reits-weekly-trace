import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import {
  BRIEF_RULES_VERSION,
  briefRulesVersionFor,
  canonicalBriefOpening,
  needsBriefRegeneration,
  parseBriefResponse,
  validateBrief,
} from '../lib/deepseek.ts';
import { describeBriefFailure } from '../lib/brief-failure.ts';
import { selectRelevantText } from '../lib/pdf-text.ts';
import { buildReplyFallback } from '../lib/deepseek.ts';

const valuation = '不动产项目整体评估值由42.73亿元调整为42.15亿元，调整幅度为-1.36%';
const other = '此外，回复报告对业务参与人资质、项目历史合规手续和关联方租赁风险等问题进行了答复';
const record = {
  exchange: '上交所',
  shortName: '测试REIT',
  status: '已回复交易所意见',
  progressType: '回复反馈',
  offeringType: '首发' as const,
  updateDate: '2026-10-08',
  brief: '',
  sourceHtml: '',
  files: [{
    label: '反馈意见答复',
    url: 'https://example.com/reply.pdf',
    kind: '回复反馈',
    originalTitle: '反馈意见答复',
    issuerRole: '原始权益人',
    content: `[第10页] ${valuation}。\n[第20页] ${other}。`,
  }],
};

function parse(sentences: string[], quotes = sentences) {
  return parseBriefResponse(JSON.stringify({
    brief: `${canonicalBriefOpening(record)}。${sentences.join('。')}。`,
    evidence: quotes.map((claim) => ({ claim, fileIndex: 1, quote: `${claim}。` })),
  }), record);
}

void test('回复原文有其他事项时拒绝只写估值的简报', () => {
  const parsed = parse([valuation]);
  assert.throws(() => validateBrief(parsed.brief, record, parsed.evidence), /missing_reply_other_topics/);
  assert.equal(describeBriefFailure(new Error('missing_reply_other_topics')), '回复简报遗漏其他回复事项');
});

void test('其他回复事项必须有回复PDF证据，缺失证据后不能降级成估值摘要', () => {
  const parsed = parse([valuation, other], [valuation]);
  assert.doesNotMatch(parsed.brief, /此外/);
  assert.throws(() => validateBrief(parsed.brief, record, parsed.evidence), /missing_reply_other_topics/);
});

void test('估值和其他回复主题均有证据时通过校验并按顺序保留', () => {
  const parsed = parse([other, valuation]);
  assert.equal(parsed.brief, `${canonicalBriefOpening(record)}。${valuation}。${other}。`);
  assert.doesNotThrow(() => validateBrief(parsed.brief, record, parsed.evidence));
  assert.deepEqual(parsed.evidence.map((item) => item.page), [10, 20]);
});

void test('没有估值调整时仍可仅概括原文实际回复事项', () => {
  const noValuation = { ...record, files: [{ ...record.files[0], content: `[第20页] ${other}。` }] };
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(noValuation)}。${other}。`, evidence: [{ claim: other, fileIndex: 1, quote: `${other}。` }] }), noValuation);
  assert.doesNotThrow(() => validateBrief(parsed.brief, noValuation, parsed.evidence));
});

const shoukai = {
  ...record, shortName: '嘉实首开REIT', updateDate: '2026-10-15',
  files: [{ ...record.files[0], originalTitle: '关于《关于嘉实首开项目申请受理反馈意见》的答复.pdf', content:
    '[第1页] 关于《关于嘉实首开项目申请受理反馈意见》的答复 上海证券交易所：就反馈意见答复如下：一、业务参与人资质及履职能力 1.关于持续经营能力。根据申报材料，原始权益人收入下降。请管理人分析对基金运营稳定性的影响。答复：原始权益人具有持续经营能力，运营管理机构配备相应人员履行职责。\n' +
    '[第47页] 二、不动产合规情况 （一）关于合规手续 请管理人、律师补充说明项目建设用地手续的合规性情况。答复：管理人与律师认为，项目取得的建筑用地执照满足建设时期需办理的建设用地许可证。\n' +
    '[第173页] 四、资产评估与估值合理性 本项目的评估基准日已由2025年9月30日更新至2026年6月30日。三个项目合计的评估值由首次申报的10.39亿元调整为8.87亿元，较首次申报下降1.52亿元，降幅14.63%，主要原因系华侨村商街项目重要现金流提供方美年美灿门诊未来的租赁条件发生重大变化。\n' +
    '[第175页] 税前折现率6.00%5.00%。\n' +
    '[第176页] 1.关于出租率。请管理人审慎评估出租率假设的合理性。答复：本次反馈答复，评估机构将项目出租率假设由98.0%调整为96.5%。\n' +
    '[第194页] 3.关于增长率。请评估机构审慎评估长期增长率取值的合理性。答复：本次反馈答复，评估机构将各项目的长期增长率由2.25%调整为2.00%。\n' +
    '[第247页] 五、基金运作与治理 （三）关于治理机制安排 请管理人评估在不同层级设置决策程序和审批权限。答复：本基金在不同层级设置针对运营管理相关重要事项的决策程序，在基金份额持有人大会、基金管理人、项目公司等各层级设置分层决策机制。\n' +
    '[第253页] 六、其他反馈意见 2.关于投保情况。请管理人披露后续投保安排。答复：目前不动产项目已购买足额的财产一切险、公众责任险、营业中断险等险种。' }],
};

void test('答复内复述的交易所问题不能支撑已经作答的结论', () => {
  const claim = '此外，回复报告还就原始权益人持续经营能力等问题进行了答复';
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(shoukai)}。${claim}。`, evidence: [{ claim, fileIndex: 1, quote: '根据申报材料，原始权益人收入下降。请管理人分析对基金运营稳定性的影响。' }] }), shoukai);
  assert.equal(parsed.evidence.some(item => item.claim === claim), false);
});

void test('嘉实首开披露整体估值调整时不能只发布其他回复主题', () => {
  const claim = '此外，回复报告还就业务参与人履职能力等问题作出说明';
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(shoukai)}。${claim}。`, evidence: [{ claim, fileIndex: 1, quote: '原始权益人具有持续经营能力，运营管理机构配备相应人员履行职责。' }] }), shoukai);
  assert.match(parsed.brief, /估值参数.*调整/);
  assert.match(parsed.brief, /10\.39亿元.*8\.87亿元.*14\.63%/);
});

void test('回复确定性保底保留参数类别、整体估值及实际答复主题和原页证据', () => {
  const result = buildReplyFallback(shoukai);
  assert.ok(result);
  assert.match(result.brief, /出租率.*长期增长率.*折现率|出租率.*折现率.*长期增长率/);
  assert.match(result.brief, /10\.39亿元.*8\.87亿元.*14\.63%/);
  assert.match(result.brief, /此外.*合规.*治理.*投保/);
  assert.doesNotMatch(result.brief, /请管理人|请评估机构|26\.97|25\.69|4\.75%/);
  for (const item of result.evidence) {
    const page = shoukai.files[0].content.split(/(?=\[第\d+页\])/).find(text => text.startsWith(`[第${item.page}页]`)) || '';
    assert.ok(page.normalize('NFKC').replace(/\s/g, '').includes(item.quote.normalize('NFKC').replace(/\s/g, '')), item.quote);
    assert.doesNotMatch(item.quote, /请管理人|请评估机构/);
  }
  assert.doesNotThrow(() => validateBrief(result.brief, shoukai, result.evidence));
  const valuationEvidence = result.evidence.filter(item => item.claim.includes('评估值'));
  assert.throws(() => validateBrief(result.brief.replace('8.87亿元', '9.87亿元'), shoukai, result.evidence), /missing_reply_valuation/);
  assert.throws(() => validateBrief(result.brief, shoukai, result.evidence.filter(item => !valuationEvidence.includes(item))), /missing_reply_valuation/);
});

void test('估值调整金额或百分比冲突时拒绝，不替原文修正数字', () => {
  assert.throws(() => buildReplyFallback({ ...shoukai, files: [{ ...shoukai.files[0], content: shoukai.files[0].content.replace('降幅14.63%', '降幅4.75%') }] }), /conflicting_reply_valuation/);
  assert.throws(() => buildReplyFallback({ ...shoukai, files: [{ ...shoukai.files[0], content: shoukai.files[0].content.replace('降幅14.63%', '整体估值下降4.75%') }] }), /conflicting_reply_valuation/);
  assert.doesNotThrow(() => buildReplyFallback({ ...shoukai, files: [{ ...shoukai.files[0], content: shoukai.files[0].content.replace('降幅14.63%', '降幅14.62%') }] }));
});

void test('只有参数调整而未披露整体估值变化时，概括参数但不编造整体金额', () => {
  const result = buildReplyFallback({ ...record, files: [{ ...record.files[0], content: '[第2页] 答复：本次反馈答复，评估机构将各项目的长期增长率由2.25%调整为2.00%。' }] });
  assert.ok(result);
  assert.match(result.brief, /长期增长率等估值参数作出调整/);
  assert.doesNotMatch(result.brief, /整体评估值|合计评估值|亿元|14\.63|4\.75/);
});

void test('回复材料截取保留中部整体估值、参数变化和真实答复，不保留原函要求', () => {
  const long = shoukai.files[0].content.replace('[第173页]', `[第90页] ${'普通分析。'.repeat(5000)}\n[第173页]`);
  const selected = selectRelevantText(long, '回复反馈', 9000);
  const compact = selectRelevantText(selected, '回复反馈', 4500);
  for (const excerpt of [selected, compact]) {
    assert.match(excerpt, /10\.39亿元.*8\.87亿元/);
    assert.match(excerpt, /14\.63%/);
    assert.match(excerpt, /具有持续经营能力/);
    assert.match(excerpt, /足额的财产一切险/);
    assert.doesNotMatch(excerpt, /请管理人|请评估机构/);
  }
});

void test('旧版回复简报在规则升级后重生成，方向错误的材料不能生成回复保底', () => {
  assert.equal(needsBriefRegeneration({ ...record, brief: parse([valuation, other]).brief, briefRulesVersion: '2026-10-09-reply-v2' }, record), true);
  assert.equal(buildReplyFallback({ ...shoukai, files: [{ ...shoukai.files[0], issuerRole: '交易所' }] }), null);
  assert.equal(buildReplyFallback({ ...shoukai, files: [{ ...shoukai.files[0], originalTitle: '关于嘉实首开项目申请受理反馈意见.pdf' }] }), null);
});

void test('其他事项同一句列举多个主题时，每个主题都必须有实际答复证据', () => {
  const parsed = parse([valuation, other]);
  const withoutProof = parsed.evidence.map(item => item.claim === other ? { ...item, quote: '回复报告对业务参与人资质进行了答复' } : item);
  const material = { ...record, files: [{ ...record.files[0], content: `${record.files[0].content}\n[第20页] 回复报告对业务参与人资质进行了答复。` }] };
  assert.throws(() => validateBrief(parsed.brief, material, withoutProof), /missing_reply_other_topics/);
});

void test('无答复段落的交易所提问，即使误标为回复文件也不能生成回复保底', () => {
  assert.equal(buildReplyFallback({ ...shoukai, files: [{ ...shoukai.files[0], content: '[第1页] 一、业务参与人资质及履职能力。根据申报材料，原始权益人持续经营能力较弱。请管理人补充说明。' }] }), null);
});

void test('不把不同句子的基金经理及兼任拼成已答复的主题', () => {
  assert.equal(buildReplyFallback({ ...record, files: [{ ...record.files[0], content: '[第2页] 答复：本项目拟任基金经理为甲。其他项目具有兼任安排。' }] }), null);
});

void test('隔离环境内模型服务失败或无效正文时，真实答复事实仍能形成完整保底稿', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { generateDeepSeekBrief } from ${JSON.stringify(new URL('../lib/deepseek.ts', import.meta.url).href)};
    let calls = 0;
    for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ output_text: 'invalid JSON' })]) {
      globalThis.fetch = async () => { calls++; return response(); };
      const result = await generateDeepSeekBrief(${JSON.stringify(shoukai)});
      assert.match(result.brief, /10\\.39亿元.*8\\.87亿元.*14\\.63%/);
      assert.match(result.brief, /此外.*合规.*投保/);
      assert.ok(result.evidence.length > 5);
    }
    assert.equal(calls, 4);
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', DEEPSEEK_API_KEY: 'test-placeholder' }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
});

void test('原文只有估值时不强行补写其他事项，也不从交易所原函借用主题', () => {
  const valuationOnly = {
    ...record,
    files: [
      { ...record.files[0], content: `[第10页] ${valuation}。` },
      { ...record.files[0], url: 'https://example.com/question.pdf', kind: '反馈意见', issuerRole: '交易所', content: `[第2页] ${other}。` },
    ],
  };
  const parsed = parse([valuation]);
  assert.doesNotThrow(() => validateBrief(parsed.brief, valuationOnly, parsed.evidence));
});

void test('回复新规则使旧估值摘要重新生成，其他阶段版本保持不变', () => {
  assert.notEqual(briefRulesVersionFor('回复反馈'), BRIEF_RULES_VERSION);
  assert.equal(briefRulesVersionFor('受理'), BRIEF_RULES_VERSION);
  assert.equal(needsBriefRegeneration({ ...record, brief: parse([valuation]).brief, briefRulesVersion: BRIEF_RULES_VERSION }, record), true);
});

void test('第二轮回复在首句明确答复对象，首轮旧文案需要重新生成', () => {
  const incoming = { ...record, files: [{ ...record.files[0], originalTitle: '第二轮反馈意见的答复.pdf' }] };
  assert.equal(canonicalBriefOpening(incoming), '10月8日，上交所网站显示，测试REIT项目就第二轮反馈意见进行了答复');
  assert.equal(canonicalBriefOpening({ ...incoming, exchange: '深交所' }), '10月8日，深交所网站显示，测试REIT项目就第二轮审核问询函进行了答复');
  assert.equal(needsBriefRegeneration({ ...incoming, brief: parse([valuation, other]).brief, briefRulesVersion: '2026-10-09-reply-v1' }, incoming), true);
});

void test('长回复报告均衡保留估值与后部其他事项，精简重试也不遗漏', () => {
  const text =
    `[第1页] ${'本反馈意见回复情况如下。'.repeat(2_000)}\n` +
    '[第40页] 联营扣率、出租率和租金收缴率等估值参数进行了调整。\n' +
    `[第41页] ${valuation}。${'估值分析'.repeat(4_000)}\n` +
    '[第60页] 一、业务参与人资质及履职能力。管理人补充说明履职情况。\n' +
    `[第61页] ${'回复具体情况'.repeat(4_000)}\n` +
    '[第80页] 二、项目历史合规手续。项目已补充历史手续说明。\n' +
    `[第81页] ${'回复具体情况'.repeat(4_000)}\n` +
    '[第100页] 三、关联方租赁与租约集中到期风险。已补充相关风险披露。';
  const selected = selectRelevantText(text, '回复反馈', 9_000);
  const compact = selectRelevantText(selected, '回复反馈', 4_500);
  for (const excerpt of [selected, compact]) {
    assert.match(excerpt, /联营扣率/);
    assert.match(excerpt, /42\.15亿元/);
    assert.match(excerpt, /业务参与人资质/);
    assert.match(excerpt, /项目历史合规手续/);
    assert.match(excerpt, /关联方租赁与租约集中到期风险/);
    assert.match(excerpt, /\[第100页\]/);
  }
  assert.ok(selected.length <= 9_000);
  assert.ok(compact.length <= 4_500);
});
