import assert from 'node:assert/strict';
import test from 'node:test';
import { describeFetchError } from '../lib/fetch-error.ts';

void test('抓取连接失败时保留安全的底层错误码', () => {
  const error = new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' }),
  });
  assert.equal(describeFetchError(error), '网络连接失败（ENOTFOUND）');
});

void test('抓取超时时区分连接超时错误码', () => {
  const error = new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect timeout'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    }),
  });
  assert.equal(
    describeFetchError(error),
    '连接超时（UND_ERR_CONNECT_TIMEOUT）',
  );
});
