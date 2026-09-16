import assert from 'node:assert/strict';
import test from 'node:test';
import { BRIEF_RULES_VERSION, isBriefDisplayable, needsBriefRegeneration, validateBrief } from '../lib/deepseek.ts';

const submission = {
  exchange: '上交所',
  shortName: '某REIT',
  status: '已申报',
  progressType: '申报',
  offeringType: '首发' as const,
  updateDate: '2026-09-15',
  originator: '某公司',
  brief: '',
  sourceHtml: '上交所项目动态显示已申报，原始权益人为某公司。',
  files: [],
};

void test('申报简报不需要为凑字数重复说明材料未披露', () => {
  assert.doesNotThrow(() =>
    validateBrief('9月15日，上交所网站显示，某REIT已申报，原始权益人为某公司。', submission),
  );
});

void test('句子未写完的简报拒绝发布', () => {
  assert.throws(
    () => validateBrief('9月15日，上交所网站显示，某REIT已申报，涉及申请', submission),
    /incomplete_sentence/,
  );
  assert.equal(isBriefDisplayable('9月15日，上交所网站显示，某REIT已申报，涉及申请', '申报'), false);
});

void test('反馈意见不能写成长篇逐项罗列', () => {
  const feedback = {
    ...submission,
    progressType: '反馈/问询',
    files: [{ label: '反馈意见', url: 'https://example.com/a.pdf', kind: '反馈意见', originalTitle: '反馈意见', content: '监管关注资产合规、估值和信息披露。' }],
  };
  const verbose = `9月15日，上交所就某REIT申请出具反馈意见，重点关注资产合规、估值和信息披露。${'交易所要求逐项补充说明资产权属、运营情况及各项财务指标。'.repeat(15)}`;
  assert.throws(() => validateBrief(verbose, feedback), /invalid_length/);
  assert.equal(isBriefDisplayable(verbose, '反馈/问询'), false);
});

void test('已受理简报的数字不能仅来自项目动态页', () => {
  const accepted = {
    ...submission,
    progressType: '受理',
    sourceHtml: '项目动态页显示已受理，评估值10亿元。',
    files: [{ label: '招募说明书', url: 'https://example.com/a.pdf', kind: '招募说明书', originalTitle: '招募说明书', content: '原始权益人为某公司，底层资产为某项目。' }],
  };
  assert.throws(
    () => validateBrief('9月15日，上交所网站显示，某REIT已受理。招募说明书披露底层资产为某项目，原始权益人为某公司，评估值10亿元，项目的其他核心参数仍需依据招募说明书正文核验。', accepted),
    /unsupported_number/,
  );
});

void test('来源未变时旧规则或失格简报仍要自动重生成', () => {
  const current = { ...submission, brief: '9月15日，上交所网站显示，某REIT已申报，原始权益人为某公司。', briefRulesVersion: BRIEF_RULES_VERSION };
  assert.equal(needsBriefRegeneration(current, submission), false);
  assert.equal(needsBriefRegeneration({ ...current, briefRulesVersion: undefined }, submission), true);
  assert.equal(needsBriefRegeneration({ ...current, brief: '涉及申请' }, submission), true);
});

void test('扩募回复简报只在原文件给出变化数据时使用数字', () => {
  const reply = {
    ...submission,
    progressType: '回复反馈',
    offeringType: '扩募' as const,
    files: [
      { label: '交易所反馈', url: 'https://example.com/q.pdf', kind: '反馈意见', originalTitle: '反馈意见', content: '交易所要求说明估值参数。' },
      { label: '原始权益人答复', url: 'https://example.com/r.pdf', kind: '回复反馈', originalTitle: '反馈意见的答复', content: '评估基准日更新后，项目评估值由10.37亿元降至9.89亿元，下降0.48亿元，降幅为4.63%。' },
    ],
  };
  assert.doesNotThrow(() => validateBrief('10月14日，上交所显示，某REIT扩募项目就受理反馈意见作出答复。答复文件披露，新增资产评估基准日更新后，评估值由10.37亿元降至9.89亿元，下降0.48亿元，降幅为4.63%。', reply));
});
