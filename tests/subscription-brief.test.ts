import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { subscriptionResultFacts } from '../lib/subscription-results.ts';
import { buildSubscriptionResultFallback, parseBriefResponse, validateBrief, canonicalBriefOpening, briefRulesVersionFor, needsBriefRegeneration } from '../lib/deepseek.ts';

const notice = '[第1页] 基金份额总额为500,000,000份。初始战略配售基金份额数量为350,000,000份。网下发售的初始基金份额数量为105,000,000份。公众投资者认购的初始基金份额数量为45,000,000份。\n[第2页] 67家网下投资者管理的341个有效报价配售对象已全部缴纳认购款，对应的有效认购基金份额数量为1,851,230万份。公众投资者的有效认购基金份额数量为1,647,466.820311万份。战略投资者有效认购申请确认比例为100%。网下投资者有效认购申请确认比例（即配售比例）为0.56719046%。\n[第3页] 公众投资者有效认购申请确认比例为0.27314478%。';
const asset = '底层资产为位于广东省清远市的飞来峡项目及位于潮州市的潮州项目，装机容量分别为14万千瓦和4.6万千瓦';
const record = { exchange: '深交所', shortName: '银华粤海水务水利REIT', status: '认购结果', progressType: '认购结果', offeringType: '首发' as const, updateDate: '2026-10-14', brief: '', sourceHtml: '', files: [
  { kind: '认购结果', label: '认购结果', originalTitle: '认购结果', url: 'https://example.com/result.pdf', content: notice },
  { kind: '招募说明书', label: '招募说明书', originalTitle: '招募说明书', url: 'https://example.com/prospectus.pdf', content: `[第32页] ${asset}。` },
  { kind: '发售', label: '发售公告', originalTitle: '发售公告', url: 'https://example.com/offering.pdf', content: '[第2页] 基金份额认购价格为3.451元/份，发售份额总额为5亿份。' },
] };

void test('认购结果按原文单位核算份额、认购倍数及预计规模，每句保留证据', () => {
  const facts = subscriptionResultFacts(record.files);
  const text = facts.map(fact => fact.claim).join('。');
  assert.match(text, /5亿份.*3\.5亿份.*1\.05亿份.*0\.45亿份/);
  assert.match(text, /185\.123亿份/);
  assert.match(text, /164\.747亿份.*0\.27314478%.*366\.1倍/);
  assert.match(text, /0\.56719046%/);
  assert.match(text, /预计募集规模为17\.255亿元/);
  assert.doesNotMatch(text, /最终募集规模|218\.26倍/);
  assert.ok(facts.every(fact => fact.evidence.length));
  assert.equal(facts.at(-1)?.evidence.length, 2);
});

void test('认购结果即使模型只给进度，也从原文补全认购事实和已核验资产', () => {
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(record)}。${asset}。`, evidence: [{ claim: asset, fileIndex: 2, quote: `${asset}。` }] }), record);
  assert.match(parsed.brief, /185\.123亿份/);
  assert.match(parsed.brief, /366\.1倍/);
  assert.match(parsed.brief, /预计募集规模为17\.255亿元/);
  assert.ok(parsed.brief.endsWith(`${asset}。`));
  assert.doesNotThrow(() => validateBrief(parsed.brief, record, parsed.evidence));
  const tableRecord = { ...record, files: record.files.map(file => file.kind === '招募说明书' ? { ...file, content: '[第32页] 不动产项目名称 项目公司1持有并运营的飞来峡项目 项目公司2持有并运营的潮州项目 不动产项目业态 水利设施 项目所在地 广东省清远市 广东省潮州市 资产范围 发电资产\n[第33页] 发电总装机容量140MW，总装机容量46MW。' } : file) };
  const tableParsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(record)}。`, evidence: [] }), tableRecord);
  assert.match(tableParsed.brief, /飞来峡项目、潮州项目.*清远市.*潮州市/);
  assert.match(tableParsed.brief, /装机容量合计约18\.6万千瓦/);
  assert.doesNotThrow(() => validateBrief(tableParsed.brief, tableRecord, tableParsed.evidence));
});

void test('认购结果不能仅发布进度或漏掉已披露的类别', () => {
  assert.throws(() => validateBrief(`${canonicalBriefOpening(record)}。仅披露公众确认比例为0.27314478%。`, record, [{ fileUrl: record.files[0].url, page: 3, claim: '仅披露公众确认比例为0.27314478%', quote: '公众投资者有效认购申请确认比例为0.27314478%' }]), /missing_subscription_fields/);
});

void test('结果与发售公告价格冲突时停止发布，不拿招募说明书的预测价格替代', () => {
  const conflicting = record.files.map(file => file.kind === '认购结果' ? { ...file, content: `${notice}\n[第4页] 认购价格为3.50元/份。` } : file);
  assert.throws(() => subscriptionResultFacts(conflicting), /conflicting_subscription_terms/);
  const noOffering = subscriptionResultFacts(record.files.filter(file => file.kind !== '发售').map(file => file.kind === '招募说明书' ? { ...file, content: `${file.content}预计认购价格为2.00元/份。` } : file));
  assert.doesNotMatch(noOffering.map(fact => fact.claim).join('。'), /认购价格|募集规模/);
  const directFinal = subscriptionResultFacts([{ kind: '认购结果', url: record.files[0].url, content: '[第4页] 最终募集规模为17.255亿元。' }]);
  assert.match(directFinal.map(fact => fact.claim).join('。'), /最终募集规模为17\.255亿元/);
  const mixed = `${asset}，预计认购价格为2.00元/份`;
  const incoming = { ...record, files: record.files.map(file => file.kind === '招募说明书' ? { ...file, content: `[第32页] ${mixed}。` } : file) };
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(incoming)}。${mixed}。`, evidence: [{ claim: mixed, fileIndex: 2, quote: `${mixed}。` }] }), incoming);
  assert.doesNotMatch(parsed.brief, /认购价格为2\.00/);
});

void test('认购结果新规则仅更新本阶段，失败的仅进度记录会再次生成', () => {
  assert.notEqual(briefRulesVersionFor('认购结果'), briefRulesVersionFor('上市'));
  assert.equal(needsBriefRegeneration({ ...record, brief: `${canonicalBriefOpening(record)}。`, briefRulesVersion: briefRulesVersionFor('认购结果') }, record), true);
});

void test('不把网下询价或网下认购倍数写成公众认购倍数', () => {
  const files = record.files.map(file => file.kind === '认购结果' ? { ...file, content: `${file.content}\n[第4页] 网下认购倍数为218.26倍。` } : file);
  const text = subscriptionResultFacts(files).map(fact => fact.claim).join('。');
  assert.match(text, /认购倍数约366\.1倍/);
  assert.doesNotMatch(text, /218\.26/);
});

// Public PDF excerpts: result 508081_20261015_2T29, prospectus 508081_20260930_XEM5.
const huaneng = {
  ...record, exchange: '上交所', shortName: '长城华能燃煤发电REIT', updateDate: '2026-10-15',
  files: [
    { ...record.files[0], content: '[第1页] 中国证监会准予本基金募集的基金份额总额为10亿份。本基金初始战略配售发售份额为70,000万份，占本次基金份额发售总量的70%。\n[第2页] 本基金网下发售的初始基金份额数量为21,000万份，占发售份额总数的比例为21%。截至2026年10月13日，《发售公告》中披露的39家网下投资者管理的201个有效报价配售对象全部按照《发售公告》的要求进行了网下认购并全额缴纳认购款，对应的有效认购基金份额数量为1,120,499万份，超过《发售公告》中规定的网下发售初始发售总量。本基金公众投资者认购的初始基金份额数量为9,000万份，占发售份额总数的比例为9%。截至2026年10月13日，公众投资者的有效认购基金份额数量为780,194.64万份。本基金战略投资者有效认购申请确认比例为100%。本基金网下投资者有效认购申请确认比例为1.87416499%。\n[第3页] 本基金公众投资者有效认购申请实际确认比例为1.153872%。' },
    { ...record.files[1], originalTitle: '招募说明书（更新）', content: '[第25页] 不动产项目名称 华能青岛项目 不动产项目业态 能源基础设施 项目所在地 山东省青岛市黄岛区 资产范围 位于山东省青岛市黄岛区港润大道16号 建设内容和规模 建设内容为2×350MW热电联产机组及其附属设备设施，2台75t/h中温中压循环流化床供热锅炉及其附属设备设施（启动锅炉）。建筑面积和可供出租或者经营使用面积（如有）华能青岛项目建筑面积合计68,526.16㎡，其中华能青岛煤电项目建筑面积61,400.50㎡。\n[第75页] 建设工程规划核实：总建筑面积：60,976.42㎡。' },
    { ...record.files[2], content: '[第16页] 本基金认购价格为3.198元/份。' },
  ],
};

function assertSourceEvidence(result: NonNullable<ReturnType<typeof buildSubscriptionResultFallback>>, material = huaneng) {
  for (const evidence of result.evidence) {
    const file = material.files.find(file => file.url === evidence.fileUrl)!;
    const page = file.content.split(/(?=\[第\d+页\])/).find(page => page.startsWith(`[第${evidence.page}页]`)) || '';
    assert.ok(page.normalize('NFKC').replace(/\s/g, '').includes(evidence.quote.normalize('NFKC').replace(/\s/g, '')), evidence.quote);
    assert.ok(result.brief.includes(evidence.claim));
  }
}

void test('长城华能真实公告措辞的战略份额和实际确认比例均被识别', () => {
  const facts = subscriptionResultFacts(huaneng.files);
  const text = facts.map(fact => fact.claim).join('。');
  assert.match(text, /10亿份.*战略配售初始份额为7亿份.*2\.1亿份.*0\.9亿份/);
  assert.match(text, /112\.05亿份.*1\.87416499%/);
  assert.match(text, /78\.019亿份.*1\.153872%.*86\.69倍/);
  assert.match(text, /预计募集规模为31\.98亿元/);
  assertSourceEvidence({ brief: text, evidence: facts.flatMap(fact => fact.evidence) });
});

void test('长城华能无需模型正文也能生成有完整原页证据的认购保底稿', () => {
  const result = buildSubscriptionResultFallback(huaneng);
  assert.ok(result);
  assert.match(result.brief, /底层资产为华能青岛项目.*位于山东省青岛市黄岛区/);
  assert.match(result.brief, /装机容量.*70万千瓦/);
  assert.doesNotMatch(result.brief, /草案|6\.1万平方米|30\.18亿元/);
  assertSourceEvidence(result);
  assert.doesNotThrow(() => validateBrief(result.brief, huaneng, result.evidence));
  const parsed = parseBriefResponse(JSON.stringify({ brief: `${canonicalBriefOpening(huaneng)}。`, evidence: [] }), huaneng);
  assert.equal(parsed.brief, result.brief);
});

void test('同类公告的初始战略份额及实际、最终确认比例措辞不依赖基金名称', () => {
  for (const strategic of ['初始战略配售发售份额', '战略配售初始基金份额数量', '初始战略配售份额数量']) {
    for (const ratio of ['有效认购申请实际确认比例', '有效认购申请最终确认比例', '有效认购申请确认比例（即配售比例）']) {
      const files = huaneng.files.map(file => file.kind === '认购结果' ? { ...file, content: file.content.replace('初始战略配售发售份额', strategic).replace('有效认购申请实际确认比例', ratio) } : file);
      const text = subscriptionResultFacts(files).map(fact => fact.claim).join('。');
      assert.match(text, /战略配售初始份额为7亿份/, strategic);
      assert.match(text, /1\.153872%/, ratio);
    }
  }
});

void test('机组数量乘单机容量支持不同单位，仅计算项目概况内机组', () => {
  for (const capacity of ['2×350MW热电联产机组', '2台350兆瓦热电联产机组', '2×35万千瓦热电联产机组', '2台350000千瓦热电联产机组']) {
    const material = { ...huaneng, files: huaneng.files.map(file => file.kind === '招募说明书' ? { ...file, content: file.content.replace('2×350MW热电联产机组', capacity) } : file) };
    const result = buildSubscriptionResultFallback(material);
    assert.ok(result);
    assert.match(result.brief, /装机容量.*70万千瓦/, capacity);
    assertSourceEvidence(result, material);
  }
});

void test('同页重复摘录不重复累计容量，同一建设内容中的不同机组组别仍相加', () => {
  for (const [construction, capacity] of [['2×350MW热电联产机组', '70'], ['2×350MW热电联产机组、1×100MW发电机组', '80']]) {
    const material = { ...huaneng, files: huaneng.files.map(file => file.kind === '招募说明书' ? { ...file, content: [file.content.replace('2×350MW热电联产机组', construction), file.content.replace('2×350MW热电联产机组', construction)].join('\n') } : file) };
    const result = buildSubscriptionResultFallback(material)!;
    assert.match(result.brief, new RegExp(`装机容量约${capacity}万千瓦`));
    assertSourceEvidence(result, material);
  }
});

void test('旧版认购完整稿在本次规则升级后也会重新生成', () => {
  assert.equal(needsBriefRegeneration({ ...record, brief: `${canonicalBriefOpening(record)}。本次发售基金份额总额为5亿份。`, briefRulesVersion: '2026-10-14-subscription-v1' }, record), true);
});

void test('认购完整性校验拒绝遗漏或篡改已从概况表提取的容量及其原页证据', () => {
  const result = buildSubscriptionResultFallback(huaneng)!;
  const scale = result.evidence.find(item => item.claim.includes('装机容量'))!;
  assert.throws(() => validateBrief(result.brief.replace(scale.claim, '上述项目装机容量约60万千瓦'), huaneng, result.evidence), /missing_subscription_asset/);
  assert.throws(() => validateBrief(result.brief, huaneng, result.evidence.filter(item => item !== scale)), /missing_subscription_asset/);
});

void test('在无用户凭据的隔离进程内，模型服务失败或返回无效正文仍生成完整认购稿', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { generateDeepSeekBrief } from ${JSON.stringify(new URL('../lib/deepseek.ts', import.meta.url).href)};
    let calls = 0;
    for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ output_text: 'invalid JSON' })]) {
      globalThis.fetch = async () => { calls++; return response(); };
      const result = await generateDeepSeekBrief(${JSON.stringify(huaneng)});
      assert.match(result.brief, /战略配售初始份额为7亿份/);
      assert.match(result.brief, /1\\.153872%.*86\\.69倍/);
      assert.match(result.brief, /31\\.98亿元/);
      assert.match(result.brief, /装机容量.*70万千瓦/);
      assert.ok(result.evidence.length > 10);
    }
    assert.equal(calls, 4);
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', DEEPSEEK_API_KEY: 'test-placeholder' }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
});
