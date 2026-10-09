import assert from 'node:assert/strict';
import test from 'node:test';
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
  const parsed = parse([other]);
  assert.doesNotThrow(() => validateBrief(parsed.brief, record, parsed.evidence));
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
