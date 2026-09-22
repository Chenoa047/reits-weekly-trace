import assert from 'node:assert/strict';
import test from 'node:test';
import { briefAfterGenerationFailure } from '../lib/refresh-brief.ts';
import type { ReitsRecord } from '../lib/reits.ts';

const existing: ReitsRecord = {
  id: 'test-reit',
  exchange: '上交所',
  fullName: '测试基础设施证券投资基金',
  shortName: '测试REIT',
  title: '测试REIT获反馈',
  status: '已反馈',
  progressType: '反馈/问询',
  offeringType: '首发',
  updateDate: '2026-09-21',
  weekStart: '2026-09-21',
  weekEnd: '2026-09-22',
  brief: '9月21日，上交所网站显示，测试REIT获反馈。反馈意见关注项目资产合规情况。',
  evidence: [{ fileUrl: 'https://example.com/old.pdf', page: 2, claim: '反馈意见关注项目资产合规情况', quote: '项目资产合规情况' }],
  files: [{ label: '反馈意见', kind: '反馈意见', originalTitle: '反馈意见', url: 'https://example.com/old.pdf' }],
  sourceHtml: '<p>旧进度</p>',
};

void test('生成失败时保留已核验简报及其原文件证据', () => {
  const incoming = {
    ...existing,
    brief: '9月22日，上交所网站显示，测试REIT获反馈。',
    evidence: [],
    files: [{ ...existing.files[0], url: 'https://example.com/new.pdf' }],
    sourceHtml: '<p>新进度</p>',
  };
  const result = briefAfterGenerationFailure(incoming, existing, 'PDF文字读取失败');
  assert.equal(result.preserved, true);
  assert.equal(result.record.brief, existing.brief);
  assert.deepEqual(result.record.evidence, existing.evidence);
  assert.deepEqual(result.record.files, existing.files);
  assert.equal(result.record.sourceHtml, existing.sourceHtml);
  assert.match(result.record.note || '', /保留此前已核验/);
});

void test('没有已核验简报时仅发布进度和失败原因', () => {
  const result = briefAfterGenerationFailure(existing, null, '规定原文件缺失');
  assert.equal(result.preserved, false);
  assert.deepEqual(result.record.evidence, []);
  assert.match(result.record.note || '', /规定原文件缺失/);
});

void test('旧记录属于不同阶段时不沿用其正文', () => {
  const result = briefAfterGenerationFailure(
    { ...existing, progressType: '回复反馈' },
    existing,
    '简报服务暂时不可用',
  );
  assert.equal(result.preserved, false);
  assert.notEqual(result.record.brief, existing.brief);
});
