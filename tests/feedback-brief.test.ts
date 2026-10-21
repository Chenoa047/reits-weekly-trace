import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { prospectusAssetFacts } from '../lib/prospectus-assets.ts';
import { selectRelevantText } from '../lib/pdf-text.ts';
import {
  BRIEF_RULES_VERSION,
  briefRulesVersionFor,
  buildExchangeQuestionFallback,
  generateDeepSeekBrief,
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
  assert.match(result.brief, /业务参与人资质及履职能力、不动产项目合规性、项目经营与财务情况和基金运作与治理机制/);
  assert.doesNotMatch(result.brief, /资产评估与估值合理性/);
  assert.match(result.brief, /其余还包括程序合规、信息披露等其他反馈意见/);
  assert.match(result.brief, /原始权益人为甲公司。底层资产为乙水厂，位于某市。$/);
  assert.deepEqual(result.evidence.filter((item) => item.claim.includes('其余还包括')).map((item) => item.page), [5, 5]);
  assert.deepEqual(result.evidence.slice(-2).map((item) => item.fileUrl), [record.files[1].url, record.files[1].url]);
  assert.notEqual(briefRulesVersionFor('反馈/问询'), BRIEF_RULES_VERSION);
  assert.equal(briefRulesVersionFor('反馈/问询'), '2026-10-21-feedback-v10');
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
  assert.equal(canonicalBriefOpening(incoming), '10月8日，上交所网站显示，华夏银泰百货REIT项目获上交所第二轮反馈意见');
  assert.equal(canonicalBriefOpening({ ...incoming, exchange: '深交所' }), '10月8日，深交所网站显示，华夏银泰百货REIT项目获深交所第二轮审核问询');
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
  assert.match(result.brief, /合规情况、资产剥离、关联交易、租约集中到期、增长率、出租率和项目品牌使用等方面展开/);
  assert.match(result.brief, /原始权益人为甲公司/);
  assert.doesNotMatch(result.brief, /业务参与人|其余还包括/);
  assert.deepEqual(result.evidence.slice(0, 7).map((item) => item.page), [1, 2, 2, 2, 2, 3, 3]);
});

void test('二轮反馈主题句采用自然表述和短标题证据时保留，少引一个主题时拒绝', () => {
  const incoming = { ...secondRound, files: [secondRound.files[0]] };
  const main = '第二轮反馈主要围绕合规情况、资产剥离、关联交易、租约集中到期、增长率、出租率及项目品牌使用等方面展开';
  const headings = ['一、关于合规情况', '二、关于资产剥离', '三、关于关联交易', '四、关于租约集中到期', '五、关于增长率', '六、关于出租率', '七、关于项目品牌使用'];
  const parsed = parseBriefResponse(JSON.stringify({
    brief: `${canonicalBriefOpening(incoming)}。${main}。`,
    evidence: headings.map((quote) => ({ claim: main, fileIndex: 1, quote })),
  }), incoming);
  assert.equal(parsed.evidence.length, 7);
  assert.equal(parsed.brief, `${canonicalBriefOpening(incoming)}。${main}。`);
  assert.doesNotThrow(() => validateBrief(parsed.brief, incoming, parsed.evidence));
  assert.throws(() => validateBrief(parsed.brief, incoming, parsed.evidence.slice(0, -1)), /missing_feedback_topics/);
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

const assetQuote = '本基金拟持有的不动产项目为位于安徽省合肥市庐阳区的合肥银泰中心一期及二期购物中心项目。';
const landQuotes = ['土地使用权面积 18,323.77 平方米', '土地使用权面积 11,000.83 平方米'];
const mainTopics = '反馈意见主要围绕合规情况、资产剥离、关联交易、租约集中到期、增长率、出租率和项目品牌使用等方面展开，要求进一步补充说明或充分披露';
const assetClaim = '招募说明书草案显示，该项目底层资产为位于安徽省合肥市庐阳区的合肥银泰中心一期及二期购物中心项目，两期土地使用权面积合计约2.93万平方米';
const approvedRecord = { ...secondRound, files: [secondRound.files[0], {
  ...secondRound.files[1], content: `[第62页] ${assetQuote}\n${landQuotes.join('\n')}\n一期登记建筑面积101,474.25平方米。`,
}] };
function approvedResponse(asset = assetClaim, main = mainTopics) {
  return JSON.stringify({ brief: `${canonicalBriefOpening(approvedRecord)}。${main}。${asset}。`, evidence: [
    ...['一、关于合规情况', '二、关于资产剥离', '三、关于关联交易', '四、关于租约集中到期', '五、关于增长率', '六、关于出租率', '七、关于项目品牌使用'].map(quote => ({ claim: main, fileIndex: 1, quote })),
    ...[assetQuote, ...landQuotes].map(quote => ({ claim: asset, fileIndex: 2, quote })),
  ] });
}

void test('确认稿保留交易所、七项主题、具体资产位置和同口径面积合计换算', () => {
  const parsed = parseBriefResponse(approvedResponse(), approvedRecord);
  assert.equal(parsed.brief, `${canonicalBriefOpening(approvedRecord)}。${mainTopics}。${assetClaim}。`);
  assert.doesNotThrow(() => validateBrief(parsed.brief, approvedRecord, parsed.evidence));
});

void test('不能仅在证据中列出七项标题而正文只写增长率', () => {
  const parsed = parseBriefResponse(approvedResponse(assetClaim, '反馈意见主要围绕增长率等方面展开'), approvedRecord);
  assert.throws(() => validateBrief(parsed.brief, approvedRecord, parsed.evidence), /missing_feedback_topics/);
});

void test('资产介绍不保留无关现金流描述，也不把登记建筑面积换成占地面积', () => {
  const extra = '，项目现金流来源分散，不存在重要现金流提供方';
  const incoming = { ...approvedRecord, files: [approvedRecord.files[0], { ...approvedRecord.files[1], content: approvedRecord.files[1].content + extra }] };
  const plainAsset = assetClaim.split('，两期')[0];
  const mixed = plainAsset + extra;
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${mixed}。`, evidence: [{ claim: mixed, fileIndex: 2, quote: assetQuote + extra }] }), { ...incoming, files: [incoming.files[0], { ...incoming.files[1], content: `[第62页] ${assetQuote + extra}` }] });
  assert.doesNotMatch(parsed.brief, /现金流|重要现金流提供方/);
  const wrong = assetClaim.replace('土地使用权面积合计约2.93', '占地面积约10.15');
  assert.doesNotMatch(parseBriefResponse(approvedResponse(wrong), approvedRecord).brief, /10\.15/);
});

void test('真实口径保底保留具体项目名称位置及土地面积，不退回泛泛的资产类别', () => {
  const result = buildExchangeQuestionFallback(approvedRecord);
  assert.ok(result);
  assert.match(result.brief, /合肥银泰中心一期及二期购物中心项目/);
  assert.match(result.brief, /土地使用权面积合计约2\.93万平方米/);
});

void test('招募说明书已披露具体资产和面积时不能发布遗漏资产的反馈简报', () => {
  const parsed = parseBriefResponse(approvedResponse(), approvedRecord);
  assert.throws(() => validateBrief(`${canonicalBriefOpening(approvedRecord)}。${mainTopics}。`, approvedRecord, parsed.evidence.filter(item => item.fileUrl === approvedRecord.files[0].url)), /missing_feedback_asset/);
});

void test('不能把具体资产名称退化成位于某地的购物中心类商业不动产', () => {
  const generic = assetClaim.replace('合肥银泰中心一期及二期购物中心项目', '购物中心类商业不动产');
  const parsed = parseBriefResponse(approvedResponse(generic), approvedRecord);
  assert.throws(() => validateBrief(parsed.brief, approvedRecord, parsed.evidence), /missing_feedback_asset/);
});

void test('登记建筑面积不能改写成占地面积或普通建筑面积，即使数字出现在原文中', () => {
  for (const metric of ['占地面积', '建筑面积']) {
    const asset = `底层资产为位于某市的甲中心，${metric}约10.15万平方米`;
    const incoming = { ...secondRound, files: [secondRound.files[0], { ...secondRound.files[1], content: '[第7页] 底层资产为位于某市的甲中心，登记建筑面积10.15万平方米。' }] };
    const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${asset}。`, evidence: [{ claim: asset, fileIndex: 2, quote: '底层资产为位于某市的甲中心，登记建筑面积10.15万平方米。' }] }), incoming);
    assert.doesNotMatch(parsed.brief, /10\.15/);
  }
});

void test('水电资产装机容量按原口径从兆瓦换算成万千瓦', () => {
  const asset = '招募说明书显示，底层资产为位于某市的乙水电站，装机容量为5.25万千瓦';
  const incoming = { ...secondRound, files: [secondRound.files[0], { ...secondRound.files[1], content: '[第7页] 底层资产为位于某市的乙水电站，装机容量为52.5兆瓦。' }] };
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${asset}。`, evidence: [{ claim: asset, fileIndex: 2, quote: '底层资产为位于某市的乙水电站，装机容量为52.5兆瓦。' }] }), incoming);
  assert.match(parsed.brief, /装机容量为5\.25万千瓦/);
});

void test('华夏中海可选择建筑总面积，不强迫改成土地面积；OCR标题不吞入括号细项', () => {
  const inquiry = { ...record.files[0], kind: '问询函', content: '[第1页] 一、业务参与人资质及履职能力 （一）关于原始权益人。\n[第3页] 二、不动产合规情况 （一）项目合规。\n[第6页] 三、项目经营与财务情况 （一）项目经营。\n[第9页] 四、资产评估与估值合理性 （一）估值。\n[第11页] 五、基金运作与治理 （一）治理。' };
  const content = '[第53页] 不动产项目名称 千灯湖环宇城项目 大类资产类型 商业不动产 不动产项目业态 购物中心 项目所在地 广东省佛山市南海区 资产范围 项目范围 建设内容和规模 总建筑面积131,734.65平方米，土地使用权面积20,000平方米。';
  const incoming = { ...record, exchange: '深交所', shortName: '华夏中海REIT', updateDate: '2026-10-13', files: [inquiry, { ...record.files[1], content }] };
  const main = '问询主要围绕业务参与人资质及履职能力、不动产合规情况、项目经营与财务情况、资产评估与估值合理性、基金运作与治理等方面展开';
  const asset = '底层资产为位于广东省佛山市南海区的千灯湖环宇城，建筑总面积约13.17万平方米';
  const headings = ['一、业务参与人资质及履职能力', '二、不动产合规情况', '三、项目经营与财务情况', '四、资产评估与估值合理性', '五、基金运作与治理'];
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${main}。${asset}。`, evidence: [
    ...headings.map(quote => ({ claim: main, fileIndex: 1, quote })),
    { claim: asset, fileIndex: 2, quote: '总建筑面积131,734.65平方米' },
    { claim: asset, fileIndex: 2, quote: '不动产项目名称 千灯湖环宇城项目' },
    { claim: asset, fileIndex: 2, quote: '项目所在地 广东省佛山市南海区' },
  ] }), incoming);
  assert.match(parsed.brief, /13\.17万平方米/);
  assert.doesNotThrow(() => validateBrief(parsed.brief, incoming, parsed.evidence));
  const fallback = buildExchangeQuestionFallback(incoming);
  assert.ok(fallback);
  assert.match(fallback.brief, /千灯湖环宇城项目.*佛山市南海区/);
});

// Prospectus excerpts from the supplied PDF, physical pages 4, 30 and 31.
// The exchange question below is a test fixture, not the actual feedback letter.
const expansionProspectus = [
  '[第4页] 本基金本次扩募发售概况如下：基金名称 汇添富上海地产租赁住房封闭式基础设施证券投资基金 不动产项目名称 璟耀项目、璟博项目 募集规模37.225亿元。',
  '[第30页] 四、不动产项目概况 表1-2不动产项目概况表 项目 项目一 项目二 不动产项目名称 璟耀项目 璟博项目 不动产项目业态 租赁住房 租赁住房',
  '[第31页] 项目 项目一 项目二 资产所在地 上海市浦东新区 上海市浦东新区 资产范围 上海市浦东新区济明路533弄1-8、10、15-19号，包括对应的房屋所有权及其占用范围内的国有建设用地使用权；上海市浦东新区东三里桥路185、189、193、195、199号等，包括房屋所有权及其占用范围内的国有建设用地使用权。建设内容和规模 主要建设内容为8幢高层住宅楼，土地面积38,223.20平方米，建筑面积147,637.72平方米；主要建设内容为新建租赁住房及相关配套设施，土地面积17,522.20平方米，建筑面积60,093.94平方米。建筑面积和可供出租或者经营使用面积（如有）建筑面积147,637.72平方米；可供出租面积147,637.72平方米；建筑面积60,093.94平方米；可供出租面积60,093.94平方米。开竣工时间以及投入运营时间。',
].join('\n');
const expansionRecord = {
  ...record, shortName: '汇添富上海地产租赁住房REIT', offeringType: '扩募' as const, updateDate: '2026-10-19',
  files: [
    { ...record.files[0], content: '[第1页] 一、关于合规情况。请补充说明。' },
    { ...record.files[1], originalTitle: '2026年度第一次扩募并新购入不动产项目招募说明书', content: expansionProspectus },
  ],
};

// Supplied 泰华城 prospectus, physical page 30 (printed page 29).
// The exchange question is an existing mock; it does not reproduce the actual feedback topics.
const taihuaProspectus = '[第30页] 四、不动产项目概况 项目 项目一 项目二 不动产项目名称 潍坊泰华城 项目 青州泰华城项目 大类资产类型 商业不动产 商业不动产 不动产项目业态 购物中心 购物中心 项目所在地 山东省潍坊市奎文区 山东省青州市 资产范围 位于山东省潍坊市奎文区的新天地项目及新天地接建项目，具体包括房屋所有权及其占用范围内的国有建设用地使用权。位于山东省青州市的青州泰华城购物中心项目。建设内容和规模 新天地项目为地上5层商业，地下2层车库及商业；新天地接建项目为地上4层商业，地下2层车库 地上4层商业，地下1层车库 建筑面积和可供出租或者经营使用面积 建筑面积119,460.26平方米 可供出租面积60,414.11平方米 建筑面积199,235.05平方米 可供出租面积68,008.35平方米 开竣工时间以及投入运营时间';
const taihuaRecord = {
  ...record, shortName: '国联安泰华城REIT', updateDate: '2026-10-20',
  files: [record.files[0], { ...record.files[1], originalTitle: '国联安泰华城招募说明书（草案）', content: taihuaProspectus }],
};

void test('泰华城建设内容无面积时读取独立建筑面积行，保留双项目位置和两项原页证据', () => {
  const result = buildExchangeQuestionFallback(taihuaRecord)!;
  assert.match(result.brief, /潍坊泰华城项目、青州泰华城项目，分别位于山东省潍坊市奎文区、山东省青州市/);
  assert.match(result.brief, /建筑面积合计约31\.87万平方米/);
  assert.doesNotMatch(result.brief, /12\.84万平方米|11\.95万平方米|19\.92万平方米/);
  const scales = result.evidence.filter(item => item.claim.includes('建筑面积合计'));
  assert.deepEqual(scales.map(item => [item.page, item.quote]), [[30, '建筑面积119,460.26平方米'], [30, '建筑面积199,235.05平方米']]);
  assertExpansionEvidence(result, taihuaRecord);
});

void test('独立面积行缺少一项目面积时仍拒绝发布，不能拿可出租面积补足', () => {
  const incoming = { ...taihuaRecord, files: taihuaRecord.files.map(file => ({ ...file, content: file.content.replace('建筑面积199,235.05平方米', '建筑面积待核验') })) };
  assert.throws(() => buildExchangeQuestionFallback(incoming), /missing_feedback_asset/);
});

void test('独立面积行精简后仍完整，建设内容重复面积时只取一个完整口径', () => {
  const text = `[第1页] ${'不相关目录'.repeat(6000)}\n${taihuaProspectus}`;
  const selected = selectRelevantText(text, '反馈资产', 9000);
  const incoming = { ...taihuaRecord, files: taihuaRecord.files.map(file => file.kind === '招募说明书' ? { ...file, content: selected } : file) };
  assert.match(buildExchangeQuestionFallback(incoming)!.brief, /建筑面积合计约31\.87万平方米/);
  const repeated = { ...taihuaRecord, files: taihuaRecord.files.map(file => ({ ...file, content: file.content.replace('建设内容和规模', '建设内容和规模 建筑面积119,460.26平方米 建筑面积199,235.05平方米') })) };
  assert.match(buildExchangeQuestionFallback(repeated)!.brief, /建筑面积合计约31\.87万平方米/);
  assert.equal(buildExchangeQuestionFallback(repeated)!.evidence.filter(item => item.claim.includes('建筑面积合计')).length, 2);
});

function assertExpansionEvidence(result: NonNullable<ReturnType<typeof buildExchangeQuestionFallback>>, material: Pick<typeof record, 'files'> = expansionRecord) {
  for (const item of result.evidence) {
    const file = material.files.find(file => file.url === item.fileUrl)!;
    const pages = file.content.split(/(?=\[第\d+页\])/).filter(page => page.startsWith(`[第${item.page}页]`));
    assert.ok(pages.some(page => page.normalize('NFKC').replace(/\s/g, '').includes(item.quote.normalize('NFKC').replace(/\s/g, ''))), item.quote);
    assert.ok(result.brief.includes(item.claim));
  }
}

void test('扩募跨页双项目表兼容资产所在地，按两项目同口径面积合计并保留原页证据', () => {
  for (const locationLabel of ['资产所在地', '项目所在地']) {
    const incoming = { ...expansionRecord, files: expansionRecord.files.map(file => ({ ...file, content: file.content.replace('资产所在地', locationLabel) })) };
    const result = buildExchangeQuestionFallback(incoming)!;
    assert.ok(result);
    assert.match(result.brief, /扩募项目获上交所反馈意见/);
    assert.match(result.brief, /底层资产为璟耀项目、璟博项目，均位于上海市浦东新区/);
    assert.match(result.brief, /建筑面积合计约20\.77万平方米/);
    assert.doesNotMatch(result.brief, /14\.76万平方米|29\.53万平方米/);
    assertExpansionEvidence(result, incoming);
    assert.deepEqual(result.evidence.filter(item => item.claim.includes('建筑面积')).map(item => item.page), [31, 31]);
  }
});

void test('扩募资产选择以本次扩募概况为准，不混入前面的已持有资产表', () => {
  const old = '[第2页] 已持有不动产项目概况 项目 项目一 不动产项目名称 旧项目 不动产项目业态 租赁住房 项目所在地 上海市闵行区 资产范围 旧资产 建筑面积999999平方米。\n';
  const incoming = { ...expansionRecord, files: expansionRecord.files.map(file => file.kind === '招募说明书' ? { ...file, content: old + file.content } : file) };
  const result = buildExchangeQuestionFallback(incoming)!;
  assert.match(result.brief, /璟耀项目、璟博项目/);
  assert.doesNotMatch(result.brief, /旧项目|闵行区|100万平方米/);
  assertExpansionEvidence(result, incoming);
});

void test('双项目不能把一项建筑面积重复披露当成两个项目的面积', () => {
  const incoming = { ...expansionRecord, files: expansionRecord.files.map(file => file.kind === '招募说明书' ? { ...file, content: file.content.replace('建筑面积60,093.94平方米', '未披露建筑面积') } : file) };
  const facts = prospectusAssetFacts(incoming.files, incoming.offeringType);
  assert.equal(facts.length, 1);
  assert.throws(() => buildExchangeQuestionFallback(incoming), /missing_feedback_asset/);
});

void test('本次扩募有两个项目时不能只采用其中一个项目的表', () => {
  const partial = '[第5页] 本次扩募拟购入项目 项目 项目一 不动产项目名称 璟耀项目 不动产项目业态 租赁住房 资产所在地 上海市浦东新区 资产范围 济明路533弄 建筑面积147637.72平方米。\n';
  const incoming = { ...expansionRecord, files: expansionRecord.files.map(file => file.kind === '招募说明书' ? { ...file, content: file.content.replace('[第30页]', `${partial}[第30页]`) } : file) };
  const result = buildExchangeQuestionFallback(incoming)!;
  assert.match(result.brief, /璟耀项目、璟博项目/);
  assert.match(result.brief, /20\.77万平方米/);
  assertExpansionEvidence(result, incoming);
});

void test('两个项目面积恰好相同仍按两列累计，不按数值去重', () => {
  const incoming = { ...expansionRecord, files: expansionRecord.files.map(file => ({ ...file, content: file.content.replaceAll('60,093.94', '147,637.72') })) };
  const result = buildExchangeQuestionFallback(incoming)!;
  assert.match(result.brief, /建筑面积合计约29\.53万平方米/);
  assertExpansionEvidence(result, incoming);
});

void test('模型遗漏扩募资产时确定性补齐，删除任一分项证据或改错合计时拒绝', () => {
  const main = '反馈意见主要围绕合规情况等方面展开，要求进一步补充说明或充分披露';
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(expansionRecord)}。${main}。`, evidence: [{ fileIndex: 1, claim: main, quote: '一、关于合规情况' }] }), expansionRecord);
  assert.match(parsed.brief, /璟耀项目、璟博项目/);
  assert.match(parsed.brief, /建筑面积合计约20\.77万平方米/);
  assert.doesNotThrow(() => validateBrief(parsed.brief, expansionRecord, parsed.evidence));
  assertExpansionEvidence(parsed);
  const scale = parsed.evidence.find(item => item.quote.includes('60,093.94'))!;
  assert.throws(() => validateBrief(parsed.brief, expansionRecord, parsed.evidence.filter(item => item !== scale)), /missing_feedback_asset/);
  assert.throws(() => validateBrief(parsed.brief.replace('20.77', '14.76'), expansionRecord, parsed.evidence), /missing_feedback_asset/);
});

void test('资产摘录优先保留完整跨页表和扩募范围，精简后仍能生成完整稿', () => {
  const text = `[第1页] ${'不相关的目录'.repeat(6000)}\n${expansionProspectus}`;
  const selected = selectRelevantText(text, '反馈资产', 9000);
  const incoming = { ...expansionRecord, files: expansionRecord.files.map(file => file.kind === '招募说明书' ? { ...file, content: selected } : file) };
  const result = buildExchangeQuestionFallback(incoming)!;
  assert.match(result.brief, /建筑面积合计约20\.77万平方米/);
  assertExpansionEvidence(result, incoming);
  assert.ok(selected.length <= 9000);
});

void test('旧版反馈完整稿和仅进度稿都会按当前规则重新生成', () => {
  const incoming = { ...expansionRecord, brief: `${canonicalBriefOpening(expansionRecord)}。反馈意见主要围绕合规情况展开。` };
  assert.equal(needsBriefRegeneration({ ...incoming, briefRulesVersion: '2026-10-14-feedback-v6' }, incoming), true);
  assert.equal(needsBriefRegeneration({ ...incoming, briefRulesVersion: '2026-10-20-feedback-v7' }, incoming), true);
  assert.equal(needsBriefRegeneration({ ...incoming, briefRulesVersion: '2026-10-20-feedback-v8' }, incoming), true);
  assert.equal(needsBriefRegeneration({ ...incoming, briefRulesVersion: '2026-10-20-feedback-v9' }, incoming), true);
  assert.equal(needsBriefRegeneration({ ...incoming, brief: `${canonicalBriefOpening(incoming)}。`, briefRulesVersion: briefRulesVersionFor('反馈/问询') }, incoming), true);
  assert.equal(briefRulesVersionFor('认购结果'), '2026-10-16-subscription-v2');
});

void test('模型服务失败或返回无效正文时，扩募仍能生成包含全部新增资产和分项证据的反馈稿', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { generateDeepSeekBrief } from ${JSON.stringify(new URL('../lib/deepseek.ts', import.meta.url).href)};
    for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ output_text: 'invalid JSON' })]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return response(); };
      const result = await generateDeepSeekBrief(${JSON.stringify(expansionRecord)});
      assert.equal(calls, 0);
      assert.match(result.brief, /璟耀项目、璟博项目/);
      assert.match(result.brief, /20\\.77万平方米/);
      assert.equal(result.evidence.filter(item => item.claim.includes('建筑面积')).length, 2);
    }
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', DEEPSEEK_API_KEY: 'test-placeholder' }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
});

// Real prospectus table, physical page 49 (printed page 48).
const pengruiRecord = {
  ...record, exchange: '深交所', shortName: '国泰海通鹏瑞利REIT', updateDate: '2026-10-19',
  files: [
    { ...record.files[0], kind: '问询函', content: '[第1页] 一、关于合规情况。请补充说明。' },
    { ...record.files[1], originalTitle: '国泰海通鹏瑞利封闭式商业不动产证券投资基金招募说明书（草案）', content:
      '[第49页] 表：不动产项目概况 不动产项目名称 鹏瑞利青羊项目，包括青羊广场项目和地下通道商业项目 不动产项目业态 商业不动产-商业零售 项目所在地 青羊广场项目：四川省成都市青羊区光华北三路55号 地下通道商业项目：四川省成都市青羊区光华东三路483号地下室光华新区地下人行通道 资产范围 青羊广场项目及地下通道商业项目。建设内容和规模 建筑面积合计121,719.21平方米，总投资合计82,842.18万元。其中：青羊广场项目：建筑面积合计为121,539.43平方米；地下通道商业项目：建筑面积合计为179.78平方米。建筑面积和可供出租面积 总建筑面积合计为121,719.21平方米，其中商业建筑面积为51,942.64平方米，文娱用房建筑面积为29,588.17平方米，车位建筑面积为40,188.40平方米。截至2026年3月31日，可供出租面积为55,509.45平方米。开竣工时间以及投入运营时间。',
    },
  ],
};

void test('鹏瑞利合计句式必须保留整体建筑面积，不能用商业部分或把总计分项重复累计', () => {
  const result = buildExchangeQuestionFallback(pengruiRecord)!;
  assert.match(result.brief, /青羊广场项目和地下通道商业项目/);
  assert.match(result.brief, /建筑面积约12\.17万平方米/);
  assert.doesNotMatch(result.brief, /5\.19万平方米|24\.34万平方米/);
  const scale = result.evidence.filter(item => item.claim.includes('建筑面积'));
  assert.equal(scale.length, 1);
  assert.equal(scale[0].page, 49);
  assert.equal(scale[0].quote, '建筑面积合计121,719.21平方米');
  const parsed = parseBriefResponse(JSON.stringify({ brief: result.brief, evidence: result.evidence.map(item => ({ claim: item.claim, fileIndex: pengruiRecord.files.findIndex(file => file.url === item.fileUrl) + 1, quote: item.quote })) }), pengruiRecord);
  assert.equal(parsed.brief, result.brief);
  assert.doesNotThrow(() => validateBrief(parsed.brief, pengruiRecord, parsed.evidence));
});

void test('面积合计、合计为、总计为和总建筑面积合计为均能提取和引用', () => {
  for (const label of ['建筑面积合计', '建筑面积合计为', '建筑面积总计为', '总建筑面积合计为', '建筑总面积合计为']) {
    const incoming = { ...pengruiRecord, files: pengruiRecord.files.map(file => file.kind === '招募说明书' ? { ...file, content: file.content.replace('建筑面积合计121,719.21', `${label}121,719.21`) } : file) };
    const result = buildExchangeQuestionFallback(incoming)!;
    assert.match(result.brief, /(?:建筑面积|总建筑面积|建筑总面积)约12\.17万平方米/);
    assert.ok(result.evidence.some(item => item.quote === `${label}121,719.21平方米`));
  }
});

void test('只有正文的总建筑面积合计为也能支持单位换算，不依赖表格补齐', () => {
  const claim = '底层资产为位于成都市青羊区的青羊广场项目和地下通道商业项目，总建筑面积约12.17万平方米';
  const quote = '底层资产为位于成都市青羊区的青羊广场项目和地下通道商业项目，总建筑面积合计为121,719.21平方米';
  const incoming = { ...pengruiRecord, files: [pengruiRecord.files[0], { ...pengruiRecord.files[1], content: `[第49页] ${quote}。` }] };
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${claim}。`, evidence: [{ claim, fileIndex: 2, quote }] }), incoming);
  assert.match(parsed.brief, /12\.17万平方米/);
});

void test('商业、文娱用房和车位的分项面积不能当成项目建筑总面积', () => {
  const claim = '底层资产为位于成都市青羊区的青羊广场项目和地下通道商业项目，建筑面积约5.19万平方米';
  for (const part of ['商业', '文娱用房', '车位']) {
    const quote = `底层资产为位于成都市青羊区的青羊广场项目和地下通道商业项目，其中${part}建筑面积为51,942.64平方米`;
    const incoming = { ...pengruiRecord, files: [pengruiRecord.files[0], { ...pengruiRecord.files[1], content: `[第49页] ${quote}。` }] };
    const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${claim}。`, evidence: [{ claim, fileIndex: 2, quote }] }), incoming);
    assert.doesNotMatch(parsed.brief, /5\.19万平方米/);
  }
});

void test('无建设内容行时也优先选整体面积，不能取商业建筑面积作为项目规模', () => {
  const content = pengruiRecord.files[1].content.replace(/建设内容和规模[\s\S]*?建筑面积和可供出租面积/, '建筑面积和可供出租面积');
  const facts = prospectusAssetFacts([{ ...pengruiRecord.files[1], content }]);
  assert.match(facts.at(-1)!.claim, /总建筑面积约12\.17万平方米/);
});

void test('明确标注商业建筑面积的真实分项表述仍可引用，不与整体建筑面积混淆', () => {
  const claim = '底层资产为位于成都市青羊区的青羊广场项目和地下通道商业项目，商业建筑面积约5.19万平方米';
  const quote = '底层资产为位于成都市青羊区的青羊广场项目和地下通道商业项目，其中商业建筑面积为51,942.64平方米';
  const incoming = { ...pengruiRecord, files: [pengruiRecord.files[0], { ...pengruiRecord.files[1], content: `[第49页] ${quote}。` }] };
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${claim}。`, evidence: [{ claim, fileIndex: 2, quote }] }), incoming);
  assert.match(parsed.brief, /商业建筑面积约5\.19万平方米/);
});

void test('鹏瑞利遇到模型不可用或只返回进度时仍从原文生成整体面积', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { generateDeepSeekBrief, canonicalBriefOpening } from ${JSON.stringify(new URL('../lib/deepseek.ts', import.meta.url).href)};
    const record = ${JSON.stringify(pengruiRecord)};
    for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ output_text: JSON.stringify({ brief: canonicalBriefOpening(record) + '。', evidence: [] }) })]) {
      globalThis.fetch = async () => response();
      const result = await generateDeepSeekBrief(record);
      assert.match(result.brief, /建筑面积约12\\.17万平方米/);
      assert.doesNotMatch(result.brief, /5\\.19万平方米/);
      assert.ok(result.evidence.some(item => item.page === 49 && item.quote === '建筑面积合计121,719.21平方米'));
    }
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', DEEPSEEK_API_KEY: 'test-placeholder' }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
});

// Tesseract OCR excerpts from the actual ten-page inquiry, not synthetic topics.
const pengruiOcr = '[第1页] 一、业务参与人资质及履职能力 〈一) 关于原始权益人 1. 关于资产重组。\n[第3页] 二、不动产合规情况。\n[第4页] 三、项目经营与财务情况 《一) 关于项目运营情况 1. 关于运营情况。\n[第6页] 四、资产评估与估值合理性。\n[第8页] 五、基金运作与治理 1. 关于运营管理费用。六、其他反馈意见 1. 关于回收资金。';

void test('鹏瑞利真实OCR标题与资产可核验时先直接成稿，网络请求为零', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must_not_request_model'); });
  const incoming = { ...pengruiRecord, files: [{ ...pengruiRecord.files[0], content: pengruiOcr }, pengruiRecord.files[1]] };
  const result = await generateDeepSeekBrief(incoming);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
  assert.match(result.brief, /资质及履职能力、不动产项目合规性、项目经营与财务情况、资产评估与估值合理性和基金运作与治理机制/);
  assert.match(result.brief, /12\.17万平方米/);
  assert.equal(result.evidence.length, 9);
  for (const item of result.evidence) {
    const file = incoming.files.find(file => file.url === item.fileUrl)!;
    assert.ok(file.content.split(/(?=\[第\d+页\])/).some(page => page.startsWith(`[第${item.page}页]`) && page.normalize('NFKC').replace(/\s/g, '').includes(item.quote.normalize('NFKC').replace(/\s/g, ''))));
  }
});

void test('OCR编号与顿号间有空格时仍识别全部一级主题，并保留实际原文', () => {
  const content = pengruiOcr.replaceAll('、', ' 、 ');
  const incoming = { ...pengruiRecord, files: [{ ...pengruiRecord.files[0], content }, pengruiRecord.files[1]] };
  const result = buildExchangeQuestionFallback(incoming)!;
  assert.ok(result);
  assert.match(result.brief, /资质及履职能力、不动产项目合规性、项目经营与财务情况、资产评估与估值合理性和基金运作与治理机制/);
  assert.equal(result.evidence.filter(item => item.fileUrl === incoming.files[0].url).length, 6);
  assert.ok(result.evidence.some(item => item.quote.startsWith('一 、 ')));
});

void test('扫描原文未识别出一级标题时报告原文原因，不调用模型或误报服务不可用', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const incoming = { ...pengruiRecord, files: [{ ...pengruiRecord.files[0], content: '[第1页] 零星OCR文字，无可核验一级标题。' }, pengruiRecord.files[1]] };
  await assert.rejects(generateDeepSeekBrief(incoming), /unreadable_feedback_headings/);
  assert.equal(network.mock.callCount(), 0);
});

void test('OCR编号带空格时，括号内细项仍不能升为一级主题', () => {
  const content = '[第1页] 一 、 关于合规情况。（ 一 、 配套手续）。\n[第2页] 二 、 其他反馈意见。请补充信息披露。';
  const result = buildExchangeQuestionFallback({ ...pengruiRecord, files: [{ ...pengruiRecord.files[0], content }, pengruiRecord.files[1]] })!;
  assert.match(result.brief, /主要围绕合规情况等方面/);
  assert.doesNotMatch(result.brief, /配套手续/);
});
