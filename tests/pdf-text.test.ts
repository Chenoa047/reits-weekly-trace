import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPdfTextTooSparse,
  selectRelevantText,
} from '../lib/pdf-text.ts';

void test('长文件优先保留与当前阶段相关的后部原文而不是只截取首页', () => {
  const front = `[第1页] ${'无关目录'.repeat(2_000)}`;
  const relevant = '[第88页] 本次发售认购价格为3.25元/份，发售时间为9月20日。';
  const text = `${front}\n${'普通内容'.repeat(2_000)}\n${relevant}`;
  const selected = selectRelevantText(text, '发售', 4_000);
  assert.match(selected, /\[第88页\]/);
  assert.match(selected, /认购价格为3\.25元\/份/);
});

void test('扫描型问询函只有页码或零星字符时必须启用OCR', () => {
  const sparse = Array.from({ length: 15 }, (_, index) =>
    index === 14 ? `[第15页] 3` : `[第${index + 1}页]`,
  ).join('\n');
  assert.equal(isPdfTextTooSparse(sparse, 15), true);
});

void test('已有足量可检索正文的PDF不重复启用OCR', () => {
  const text = Array.from(
    { length: 5 },
    (_, index) =>
      `[第${index + 1}页] 审核问询函主要关注业务参与人资质、不动产合规、项目经营与财务、资产评估及基金治理。`,
  ).join('\n');
  assert.equal(isPdfTextTooSparse(text, 5), false);
});
