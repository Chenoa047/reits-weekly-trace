import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readCurrentWeekLocalRecords,
  serializeLocalRecords,
} from '../lib/visitor-edits.ts';

type RecordStub = {
  id: string;
  weekStart: string;
  weekEnd: string;
};

const currentRange = { start: '2026-09-28', end: '2026-09-28' };
const currentRecord: RecordStub = {
  id: 'current',
  weekStart: currentRange.start,
  weekEnd: currentRange.end,
};

void test('同一周的本地编辑继续覆盖服务器内容', () => {
  const saved = serializeLocalRecords([currentRecord], currentRange);
  assert.deepEqual(
    readCurrentWeekLocalRecords<RecordStub>(saved, currentRange),
    [currentRecord],
  );
});

void test('上周本地编辑不能覆盖本周服务器内容', () => {
  const saved = serializeLocalRecords(
    [{ id: 'old', weekStart: '2026-09-21', weekEnd: '2026-09-27' }],
    { start: '2026-09-21', end: '2026-09-27' },
  );
  assert.equal(
    readCurrentWeekLocalRecords<RecordStub>(saved, currentRange),
    null,
  );
});

void test('旧版同周本地数据可继续使用，旧版空数据和损坏数据回退到服务器', () => {
  assert.deepEqual(
    readCurrentWeekLocalRecords<RecordStub>(
      JSON.stringify([currentRecord]),
      currentRange,
    ),
    [currentRecord],
  );
  assert.equal(
    readCurrentWeekLocalRecords<RecordStub>('[]', currentRange),
    null,
  );
  assert.equal(
    readCurrentWeekLocalRecords<RecordStub>('{broken', currentRange),
    null,
  );
});
