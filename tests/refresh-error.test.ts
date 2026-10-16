import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRefreshDatabaseError, describeCnbDatabaseError, isTransientDatabaseError } from '../lib/refresh-error.ts';

void test('缺少数据库配置时给出可操作提示', () => {
  assert.match(describeRefreshDatabaseError(new Error('Turso 数据库尚未配置。')), /数据库未配置/);
});

void test('抓取任务表未升级时不误报 CNB 不可用', () => {
  assert.match(describeRefreshDatabaseError(new Error('SQLITE_ERROR: no such table: refresh_locks')), /任务表尚未完成升级/);
});

void test('数据库连接失败时不回显原始错误细节', () => {
  assert.equal(describeRefreshDatabaseError(new Error('fetch failed: [redacted]')), '网站暂时无法连接数据库，请稍后重试。');
  assert.equal(describeRefreshDatabaseError(new Error('unexpected detail: [redacted]')), '数据库无法创建或查询抓取任务，请检查数据库状态。');
});

void test('CNB 数据库诊断只输出固定分类，不输出原始地址或错误内容', () => {
  const error = new TypeError('fetch failed: https://example.invalid/private', {
    cause: Object.assign(new Error('private detail'), { code: 'ENOTFOUND' }),
  });
  assert.equal(describeCnbDatabaseError(error), 'CNB 无法解析数据库域名（ENOTFOUND）。');
  assert.equal(isTransientDatabaseError(error), true);
  const timeout = new Error('fetch failed', {
    cause: Object.assign(new Error('private detail'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
  });
  assert.match(describeCnbDatabaseError(timeout), /连接数据库超时/);
  assert.equal(isTransientDatabaseError(new Error('HTTP 401 unauthorized')), false);
  assert.equal(isTransientDatabaseError(new Error('no such table')), false);
  assert.doesNotMatch(describeCnbDatabaseError(new Error('private detail')), /private detail/);
});
