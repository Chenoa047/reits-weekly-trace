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
  assert.equal(
    describeBriefFailure(new Error('no_verified_detail')),
    '未生成可核验正文',
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

void test('区分问询原文不可读和模型请求失败，提示只含固定安全分类', () => {
  assert.equal(describeBriefFailure(new Error('unreadable_feedback_headings')), '反馈/问询原文一级标题未识别，请核查扫描件OCR');
  assert.equal(describeBriefFailure(new Error('timeout')), '简报模型请求超时');
  assert.equal(describeBriefFailure(new Error('rate_limited')), '简报模型服务限流（HTTP 429）');
  assert.equal(describeBriefFailure(new Error('provider_unavailable')), '简报模型服务返回异常（HTTP 5xx）');
  assert.equal(describeBriefFailure(new Error('request_failed')), '简报模型请求未成功');
});
