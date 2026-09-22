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

const record = {
  exchange: '深交所',
  shortName: '测试REIT',
  status: '发售',
  progressType: '发售',
  offeringType: '首发' as const,
  updateDate: '2026-09-22',
  brief: '',
  sourceHtml: '',
  files: [
    {
      label: '基金份额发售公告',
      url: 'https://example.com/offering.pdf',
      kind: '发售',
      originalTitle: '基金份额发售公告',
      content:
        '[第1页] 证监会以证监许可〔2026〕1234号准予募集注册，基金代码为180001。\n' +
        '[第2页] 本次发售认购价格为4.20元/份，基金运作方式为契约型封闭式，存续期限为30年，发售份额总额为2亿份。\n' +
        '[第3页] 战略配售初始份额为1.2亿份、占比60%，其中原始权益人关联方为0.4亿份、占比20%，其他战略投资者为0.8亿份、占比40%；网下初始份额为0.6亿份、占比30%，公众初始份额为0.2亿份、占比10%。',
    },
    {
      label: '最新招募说明书',
      url: 'https://example.com/prospectus.pdf',
      kind: '招募说明书',
      originalTitle: '招募说明书',
      content: '[第8页] 项目原始权益人为甲公司，底层资产为甲园区，位于某市，建筑面积8万平方米。',
    },
  ],
};

void test('发售使用指定首句，只有发售旧规则需要重生成', () => {
  assert.equal(canonicalBriefOpening(record), '9月22日，深交所网站显示，测试REIT发布基金份额发售公告');
  assert.notEqual(briefRulesVersionFor('发售'), BRIEF_RULES_VERSION);
  assert.equal(briefRulesVersionFor('上市'), BRIEF_RULES_VERSION);
  assert.equal(
    needsBriefRegeneration(
      { ...record, brief: `${canonicalBriefOpening(record)}。`, briefRulesVersion: BRIEF_RULES_VERSION },
      record,
    ),
    true,
  );
});

void test('发售事实按新顺序排列，募集金额由公告价格与总份额核算', () => {
  const registration = '证监会以证监许可〔2026〕1234号准予募集注册，基金代码为180001';
  const terms = '本次发售认购价格为4.20元/份，基金运作方式为契约型封闭式，存续期限为30年，发售份额总额为2亿份';
  const allocation = '战略配售初始份额为1.2亿份、占比60%，其中原始权益人关联方为0.4亿份、占比20%，其他战略投资者为0.8亿份、占比40%；网下初始份额为0.6亿份、占比30%，公众初始份额为0.2亿份、占比10%';
  const scale = '按认购价格和发售份额总额计算，预计募集资金总额为8.40亿元';
  const asset = '项目原始权益人为甲公司，底层资产为甲园区，位于某市，建筑面积8万平方米';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${asset}。${scale}。${allocation}。${terms}。${registration}。`,
      evidence: [
        { claim: asset, fileIndex: 2, quote: `${asset}。` },
        { claim: scale, fileIndex: 1, quote: '本次发售认购价格为4.20元/份' },
        { claim: scale, fileIndex: 1, quote: '发售份额总额为2亿份' },
        { claim: allocation, fileIndex: 1, quote: `${allocation}。` },
        { claim: terms, fileIndex: 1, quote: `${terms}。` },
        { claim: registration, fileIndex: 1, quote: `${registration}。` },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `${canonicalBriefOpening(record)}。${registration}。${terms}。${allocation}。${scale}。${asset}。`,
  );
  assert.equal(parsed.evidence.filter((item) => item.claim === scale).length, 2);
  assert.doesNotThrow(() => validateBrief(parsed.brief, record, parsed.evidence));
});

void test('发售金额算错或引用错文件时不发布对应事实', () => {
  const wrongScale = '按认购价格和发售份额总额计算，预计募集资金总额为9.40亿元';
  const invalidScale = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${wrongScale}。`,
      evidence: [
        { claim: wrongScale, fileIndex: 1, quote: '本次发售认购价格为4.20元/份' },
        { claim: wrongScale, fileIndex: 1, quote: '发售份额总额为2亿份' },
      ],
    }),
    record,
  );
  assert.equal(invalidScale.evidence.length, 0);

  const conflictingScale = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${wrongScale}。`,
      evidence: [
        { claim: wrongScale, fileIndex: 1, quote: '本次发售认购价格为4.20元/份' },
        { claim: wrongScale, fileIndex: 1, quote: '发售份额总额为2亿份' },
        { claim: wrongScale, fileIndex: 1, quote: '预计募集资金总额为9.40亿元' },
      ],
    }),
    {
      ...record,
      files: [{ ...record.files[0], content: `${record.files[0].content}\n[第4页] 预计募集资金总额为9.40亿元。` }, record.files[1]],
    },
  );
  assert.equal(conflictingScale.evidence.length, 0);

  const terms = '本次发售认购价格为4.20元/份';
  const wrongTermsSource = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${terms}。`,
      evidence: [{ claim: terms, fileIndex: 2, quote: `${terms}。` }],
    }),
    {
      ...record,
      files: [record.files[0], { ...record.files[1], content: `${record.files[1].content}\n[第9页] ${terms}。` }],
    },
  );
  assert.equal(wrongTermsSource.evidence.length, 0);

  const asset = '项目原始权益人为甲公司，底层资产为甲园区，位于某市';
  const wrongAssetSource = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${asset}。`,
      evidence: [{ claim: asset, fileIndex: 1, quote: `${asset}。` }],
    }),
    {
      ...record,
      files: [{ ...record.files[0], content: `${record.files[0].content}\n[第4页] ${asset}。` }, record.files[1]],
    },
  );
  assert.equal(wrongAssetSource.evidence.length, 0);
});

void test('发售总份额以万份披露时按单位换算募集金额', () => {
  const claim = '按认购价格和发售份额总额计算，预计募集资金总额为7.50亿元';
  const smallerUnit = {
    ...record,
    files: [
      { ...record.files[0], content: '[第2页] 认购价格为2.50元/份，发售份额总额为30000万份。' },
      record.files[1],
    ],
  };
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(smallerUnit)}。${claim}。`,
      evidence: [
        { claim, fileIndex: 1, quote: '认购价格为2.50元/份' },
        { claim, fileIndex: 1, quote: '发售份额总额为30000万份' },
      ],
    }),
    smallerUnit,
  );
  assert.equal(parsed.brief, `${canonicalBriefOpening(smallerUnit)}。${claim}。`);
});
