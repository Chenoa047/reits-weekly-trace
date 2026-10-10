import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIEF_RULES_VERSION,
  briefRulesVersionFor,
  buildExchangeQuestionFallback,
  canonicalBriefOpening,
  needsBriefRegeneration,
  parseBriefResponse,
  validateBrief,
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
  assert.equal(briefRulesVersionFor('反馈/问询'), '2026-10-09-feedback-v4');
  assert.notEqual(briefRulesVersionFor('回复反馈'), BRIEF_RULES_VERSION);
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

void test('银泰二轮反馈概括本轮七项主题，不沿用首轮答复的估值调整', () => {
  const headings = [
    '一、关于合规情况。', '二、关于资产剥离。', '三、关于关联交易。',
    '四、关于租约集中到期。', '五、关于增长率。', '六、关于出租率。',
    '七、关于项目品牌使用。',
  ];
  const main = '反馈意见主要围绕合规情况、资产剥离、关联交易、租约集中到期、增长率、出租率及项目品牌使用等方面展开';
  const stale = '不动产项目整体评估值由42.73亿元调整为42.15亿元，调整幅度为-1.36%';
  const incoming = {
    ...record, shortName: '华夏银泰百货REIT', updateDate: '2026-10-08',
    files: [
      { ...record.files[0], content: `[第1页] ${headings.slice(0, 1).join('')}\n[第2页] ${headings.slice(1, 5).join('')}\n[第3页] ${headings.slice(5).join('')}` },
      { ...record.files[0], kind: '回复反馈', issuerRole: '原始权益人', url: 'https://example.com/old-reply.pdf', content: `[第10页] ${stale}。` },
    ],
  };
  const parsed = parseBriefResponse(JSON.stringify({
    brief: `${canonicalBriefOpening(incoming)}。${main}。${stale}。`,
    evidence: [
      ...headings.map((quote) => ({ claim: main, fileIndex: 1, quote })),
      { claim: stale, fileIndex: 2, quote: `${stale}。` },
    ],
  }), incoming);
  assert.equal(parsed.brief, `${canonicalBriefOpening(incoming)}。${main}。`);
  assert.equal(parsed.evidence.length, 7);
  assert.doesNotMatch(parsed.brief, /进行了答复|42\.73|42\.15|此外/);
});

void test('二轮交易所反馈在首句明确轮次，不能写成二轮回复', () => {
  const incoming = {
    ...record, shortName: '华夏银泰百货REIT', updateDate: '2026-10-08',
    files: [{ ...record.files[0], originalTitle: '申请受理第二轮反馈意见.pdf' }],
  };
  assert.equal(canonicalBriefOpening(incoming), '10月8日，上交所网站显示，华夏银泰百货REIT项目获第二轮反馈');
  assert.equal(canonicalBriefOpening({ ...incoming, exchange: '深交所' }), '10月8日，深交所网站显示，华夏银泰百货REIT项目获第二轮审核问询');
});

const secondRound = {
  ...record, shortName: '华夏银泰百货REIT', updateDate: '2026-10-08',
  files: [
    { ...record.files[0], originalTitle: '第二轮反馈意见.pdf', content:
      '[第1页] 一、关于合规情况。请说明手续办理情况。\n' +
      '[第2页] 二、关于资产剥离。三、关于关联交易。四、关于租约集中到期。五、关于增长率。\n' +
      '[第3页] 六、关于出租率。七、关于项目品牌使用。' },
    record.files[1],
  ],
};

void test('有反馈原文时，仅有进度和资产介绍不能当成完整简报', () => {
  const asset = '原始权益人为甲公司，底层资产为乙水厂，位于某市';
  const parsed = parseBriefResponse(JSON.stringify({
    brief: `${canonicalBriefOpening(secondRound)}。${asset}。`,
    evidence: [{ claim: asset, fileIndex: 2, quote: '原始权益人为甲公司。底层资产为乙水厂，位于某市。' }],
  }), secondRound);
  assert.throws(() => validateBrief(parsed.brief, secondRound, parsed.evidence), /missing_feedback_topics/);
});

void test('二轮反馈保底直接概括七个实际一级标题，不套用首轮五大类', () => {
  const result = buildExchangeQuestionFallback(secondRound);
  assert.ok(result);
  assert.match(result.brief, /合规情况、资产剥离、关联交易、租约集中到期、增长率、出租率、项目品牌使用等方面展开/);
  assert.match(result.brief, /原始权益人为甲公司/);
  assert.doesNotMatch(result.brief, /业务参与人|其余还包括/);
  assert.deepEqual(result.evidence.slice(0, 7).map((item) => item.page), [1, 2, 2, 2, 2, 3, 3]);
});

void test('二轮反馈主题句采用自然表述和短标题证据时保留，少引一个主题时拒绝', () => {
  const main = '第二轮反馈主要围绕合规情况、资产剥离、关联交易、租约集中到期、增长率、出租率及项目品牌使用等方面展开';
  const headings = ['一、关于合规情况', '二、关于资产剥离', '三、关于关联交易', '四、关于租约集中到期', '五、关于增长率', '六、关于出租率', '七、关于项目品牌使用'];
  const parsed = parseBriefResponse(JSON.stringify({
    brief: `${canonicalBriefOpening(secondRound)}。${main}。`,
    evidence: headings.map((quote) => ({ claim: main, fileIndex: 1, quote })),
  }), secondRound);
  assert.equal(parsed.evidence.length, 7);
  assert.equal(parsed.brief, `${canonicalBriefOpening(secondRound)}。${main}。`);
  assert.doesNotThrow(() => validateBrief(parsed.brief, secondRound, parsed.evidence));
  assert.throws(() => validateBrief(parsed.brief, secondRound, parsed.evidence.slice(0, -1)), /missing_feedback_topics/);
});

void test('通用标题保底不把括号内细项和其他意见内部细项升为一级主题', () => {
  const incoming = { ...record, files: [{ ...record.files[0], content:
    '[第1页] 一、关于合规情况。（十一、配套手续）。\n' +
    '[第2页] 二、其他反馈意见。请补充信息披露。\n[第3页] 一、补充材料要求。' }] };
  const result = buildExchangeQuestionFallback(incoming);
  assert.ok(result);
  assert.match(result.brief, /主要围绕合规情况等方面展开/);
  assert.doesNotMatch(result.brief, /配套手续|补充材料要求/);
});
