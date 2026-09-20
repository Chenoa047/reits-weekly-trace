import assert from 'node:assert/strict';
import test from 'node:test';
import {
  briefFailureUsage,
  describeBriefFailure,
  preserveBriefUsage,
} from '../lib/brief-failure.ts';

void test('质量失败按可行动原因分类', () => {
  assert.equal(
    describeBriefFailure(new Error('invalid_evidence_format')),
    '模型返回格式错误',
  );
  assert.equal(
    describeBriefFailure(new Error('missing_evidence_coverage')),
    '逐句证据不完整',
  );
  assert.equal(
    describeBriefFailure(new Error('invalid_evidence_source')),
    '引用原文无法匹配',
  );
  assert.equal(
    describeBriefFailure(new Error('evidence_number_mismatch')),
    '数字与原文不一致',
  );
  assert.equal(
    describeBriefFailure(new Error('incomplete_max_output_tokens')),
    '模型输出达到上限',
  );
});

void test('校验失败仍保留模型用量', () => {
  const error = preserveBriefUsage(
    new Error('invalid_opening'),
    1234,
    321,
  );
  assert.equal(describeBriefFailure(error), '首句格式不合格');
  assert.deepEqual(briefFailureUsage(error), {
    inputTokens: 1234,
    outputTokens: 321,
  });
});
