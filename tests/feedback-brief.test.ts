import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIEF_RULES_VERSION,
  briefRulesVersionFor,
  buildExchangeQuestionFallback,
  canonicalBriefOpening,
  needsBriefRegeneration,
  parseBriefResponse,
} from '../lib/deepseek.ts';

const record = {
  exchange: '上交所',
  shortName: '测试REIT',
  status: '已反馈',
  progressType: '反馈/问询',
  offeringType: '首发' as const,
  updateDate: '2026-09-22',
  brief: '',
  sourceHtml: '',
  files: [
    {
      label: '受理反馈意见',
      url: 'https://example.com/feedback.pdf',
      kind: '反馈意见',
      originalTitle: '受理反馈意见',
      issuerRole: '交易所',
      content:
        '[第1页] 一、业务参与人资质及履职能力。（一）请说明资产评估细节及程序合规事项。\n' +
        '[第2页] 二、不动产合规情况。\n' +
        '[第3页] 三、项目经营与财务情况。\n' +
        '[第4页] 四、基金运作与治理。\n' +
        '[第5页] 五、其他反馈意见。请补充说明程序合规与信息披露事项。',
    },
    {
      label: '最新招募说明书',
      url: 'https://example.com/prospectus.pdf',
      kind: '招募说明书',
      originalTitle: '招募说明书',
      publishedAt: '2026-09-20',
      content: '[第7页] 原始权益人为甲公司。底层资产为乙水厂，位于某市。',
    },
  ],
};

void test('保底简报只概括一级标题，其他意见单列，最后介绍招募说明书资产', () => {
  const result = buildExchangeQuestionFallback(record);
  assert.ok(result);
  assert.match(result.brief, /业务参与人资质及履职能力、不动产项目合规性、项目经营与财务情况、基金运作与治理机制/);
  assert.doesNotMatch(result.brief, /资产评估与估值合理性/);
  assert.match(result.brief, /其余还包括程序合规、信息披露等其他反馈意见/);
  assert.match(result.brief, /原始权益人为甲公司。底层资产为乙水厂，位于某市。$/);
  assert.deepEqual(result.evidence.filter((item) => item.claim.includes('其余还包括')).map((item) => item.page), [5, 5]);
  assert.deepEqual(result.evidence.slice(-2).map((item) => item.fileUrl), [record.files[1].url, record.files[1].url]);
  assert.notEqual(briefRulesVersionFor('反馈/问询'), BRIEF_RULES_VERSION);
  assert.equal(briefRulesVersionFor('反馈/问询'), '2026-09-22-feedback-v2');
  assert.equal(briefRulesVersionFor('回复反馈'), BRIEF_RULES_VERSION);
  assert.equal(
    needsBriefRegeneration(
      { ...record, brief: result.brief, briefRulesVersion: BRIEF_RULES_VERSION },
      record,
    ),
    true,
  );
});

void test('反馈简报删除一级主题后的细分问题罗列', () => {
  const main = '反馈意见主要围绕业务参与人资质及履职能力、不动产合规情况展开';
  const details = '包括原始权益人股权转让、基金管理人专业能力、合规手续及资产重组等细分问题';
  const other = '其余还包括程序合规与信息披露等其他反馈意见';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${main}。${details}。${other}。`,
      evidence: [
        { claim: main, fileIndex: 1, quote: '一、业务参与人资质及履职能力。' },
        { claim: main, fileIndex: 1, quote: '二、不动产合规情况。' },
        { claim: details, fileIndex: 1, quote: '（一）请说明资产评估细节及程序合规事项。' },
        { claim: other, fileIndex: 1, quote: '请补充说明程序合规与信息披露事项。' },
      ],
    }),
    record,
  );
  assert.equal(parsed.brief, `${canonicalBriefOpening(record)}。${main}。${other}。`);
  assert.equal(parsed.evidence.some((item) => item.claim === details), false);
});

void test('反馈正文按一级主题、其他意见、资产介绍的顺序展示', () => {
  const main = '反馈意见主要围绕业务参与人资质及履职能力、不动产合规情况展开';
  const other = '其余还包括程序合规与信息披露等其他反馈意见';
  const asset = '原始权益人为甲公司，底层资产为乙水厂，位于某市';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${asset}。${other}。${main}。`,
      evidence: [
        { claim: asset, fileIndex: 2, quote: '原始权益人为甲公司。底层资产为乙水厂，位于某市。' },
        { claim: other, fileIndex: 1, quote: '请补充说明程序合规与信息披露事项。' },
        { claim: main, fileIndex: 1, quote: '一、业务参与人资质及履职能力。' },
        { claim: main, fileIndex: 1, quote: '二、不动产合规情况。' },
      ],
    }),
    record,
  );
  assert.equal(parsed.brief, `${canonicalBriefOpening(record)}。${main}。${other}。${asset}。`);
});

void test('其他反馈不能引用前面大项，资产不能引用交易所原函', () => {
  const other = '其余还包括程序合规等其他反馈意见';
  const invalidOther = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${other}。`,
      evidence: [{ claim: other, fileIndex: 1, quote: '请说明资产评估细节及程序合规事项。' }],
    }),
    record,
  );
  assert.equal(invalidOther.evidence.length, 0);

  const asset = '底层资产为乙水厂，位于某市';
  const invalidAsset = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${asset}。`,
      evidence: [{ claim: asset, fileIndex: 1, quote: `${asset}。` }],
    }),
    {
      ...record,
      files: [
        { ...record.files[0], content: `${record.files[0].content}\n[第6页] ${asset}。` },
        record.files[1],
      ],
    },
  );
  assert.equal(invalidAsset.evidence.length, 0);
});
