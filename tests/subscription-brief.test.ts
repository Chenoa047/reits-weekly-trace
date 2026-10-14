import assert from 'node:assert/strict';
import test from 'node:test';
import { subscriptionResultFacts } from '../lib/subscription-results.ts';
import { parseBriefResponse, validateBrief, canonicalBriefOpening, briefRulesVersionFor, needsBriefRegeneration } from '../lib/deepseek.ts';

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
