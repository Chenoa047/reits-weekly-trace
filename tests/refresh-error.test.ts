import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRefreshDatabaseError } from '../lib/refresh-error.ts';

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
