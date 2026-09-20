import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRelevantText } from '../lib/pdf-text.ts';

void test('长文件优先保留与当前阶段相关的后部原文而不是只截取首页', () => {
  const front = `[第1页] ${'无关目录'.repeat(2_000)}`;
  const relevant = '[第88页] 本次发售认购价格为3.25元/份，发售时间为9月20日。';
  const text = `${front}\n${'普通内容'.repeat(2_000)}\n${relevant}`;
  const selected = selectRelevantText(text, '发售', 4_000);
  assert.match(selected, /\[第88页\]/);
  assert.match(selected, /认购价格为3\.25元\/份/);
});
