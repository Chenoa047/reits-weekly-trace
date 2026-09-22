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
  exchange: '上交所',
  shortName: '测试REIT',
  status: '询价',
  progressType: '询价',
  offeringType: '首发' as const,
  updateDate: '2026-09-22',
  brief: '',
  sourceHtml: '',
  files: [
    {
      label: '基金份额询价公告',
      url: 'https://example.com/inquiry.pdf',
      kind: '询价',
      originalTitle: '基金份额询价公告',
      content:
        '[第1页] 证监会以证监许可〔2026〕1234号准予募集注册，基金代码为508001。\n' +
        '[第2页] 本次询价区间为3.10元/份至3.60元/份，询价日为9月25日，募集期预计为10月20日至10月22日。\n' +
        '[第3页] 本次发售份额总额为2亿份，战略配售初始份额为1.2亿份、占比60%，其中原始权益人及关联方为0.4亿份、其他战略投资者为0.8亿份；网下初始份额为0.6亿份、占比30%，公众初始份额为0.2亿份、占比10%。',
    },
    {
      label: '最新招募说明书',
      url: 'https://example.com/prospectus.pdf',
      kind: '招募说明书',
      originalTitle: '招募说明书',
      content:
        '[第8页] 项目原始权益人为甲公司，底层资产为甲园区，位于北京市，建筑面积为10万平方米。',
    },
  ],
};

void test('询价采用指定首句，且仅询价旧规则触发重新生成', () => {
  assert.equal(
    canonicalBriefOpening(record),
    '9月22日，上交所网站显示，测试REIT发布基金份额询价公告',
  );
  assert.notEqual(briefRulesVersionFor('询价'), BRIEF_RULES_VERSION);
  assert.equal(briefRulesVersionFor('受理'), BRIEF_RULES_VERSION);
  assert.equal(
    needsBriefRegeneration(
      { ...record, brief: `${canonicalBriefOpening(record)}。`, briefRulesVersion: BRIEF_RULES_VERSION },
      record,
    ),
    true,
  );
});

void test('询价事实按新顺序排列，金额区间须由公告价格和总份额算出', () => {
  const registration = '证监会以证监许可〔2026〕1234号准予募集注册，基金代码为508001';
  const timetable = '本次询价区间为3.10元/份至3.60元/份，询价日为9月25日，募集期预计为10月20日至10月22日';
  const allocation = '本次发售份额总额为2亿份，战略配售初始份额为1.2亿份、占比60%，其中原始权益人及关联方为0.4亿份、其他战略投资者为0.8亿份；网下初始份额为0.6亿份、占比30%，公众初始份额为0.2亿份、占比10%';
  const scale = '按询价区间上下限计算，预计募集资金总额为6.20亿元至7.20亿元';
  const asset = '项目原始权益人为甲公司，底层资产为甲园区，位于北京市，建筑面积为10万平方米';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${asset}。${scale}。${allocation}。${timetable}。${registration}。`,
      evidence: [
        { claim: asset, fileIndex: 2, quote: `${asset}。` },
        { claim: scale, fileIndex: 1, quote: '本次询价区间为3.10元/份至3.60元/份' },
        { claim: scale, fileIndex: 1, quote: '本次发售份额总额为2亿份' },
        { claim: allocation, fileIndex: 1, quote: `${allocation}。` },
        { claim: timetable, fileIndex: 1, quote: `${timetable}。` },
        { claim: registration, fileIndex: 1, quote: `${registration}。` },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `${canonicalBriefOpening(record)}。${registration}。${timetable}。${allocation}。${scale}。${asset}。`,
  );
  assert.equal(parsed.evidence.filter((item) => item.claim === scale).length, 2);
  assert.doesNotThrow(() => validateBrief(parsed.brief, record, parsed.evidence));
});

void test('询价计算错误或拿招募说明书证明发行数据时不发布该句', () => {
  const wrongScale = '按询价区间上下限计算，预计募集资金总额为6.20亿元至8.20亿元';
  const wrong = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${wrongScale}。`,
      evidence: [
        { claim: wrongScale, fileIndex: 1, quote: '本次询价区间为3.10元/份至3.60元/份' },
        { claim: wrongScale, fileIndex: 1, quote: '本次发售份额总额为2亿份' },
      ],
    }),
    record,
  );
  assert.equal(wrong.evidence.length, 0);

  const registration = '证监会以证监许可〔2026〕1234号准予募集注册，基金代码为508001';
  const misplaced = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${registration}。`,
      evidence: [{ claim: registration, fileIndex: 2, quote: '项目原始权益人为甲公司，底层资产为甲园区' }],
    }),
    record,
  );
  assert.equal(misplaced.evidence.length, 0);

  const asset = '项目原始权益人为甲公司，底层资产为甲园区，位于北京市，建筑面积为10万平方米';
  const wrongAssetSource = parseBriefResponse(
    JSON.stringify({
      brief: `${canonicalBriefOpening(record)}。${asset}。`,
      evidence: [{ claim: asset, fileIndex: 1, quote: `${asset}。` }],
    }),
    {
      ...record,
      files: [
        { ...record.files[0], content: `${record.files[0].content}\n[第4页] ${asset}。` },
        record.files[1],
      ],
    },
  );
  assert.equal(wrongAssetSource.evidence.length, 0);
});
