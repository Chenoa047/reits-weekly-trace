import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstSzseAnnouncementValue,
  szseAnnouncementHistoryBody,
  szseSupportingHistoryStart,
  sameSzseFund,
} from '../lib/szse-announcements.ts';

void test('深交所历史公告查询包含周一起始日和周日结束日', () => {
  assert.deepEqual(szseAnnouncementHistoryBody('2026-09-14', '2026-09-20', 1), {
    seDate: ['2026-09-14', '2026-09-20'],
    channelCode: ['reits-xxpl'],
    pageSize: 50,
    pageNum: 1,
  });
});

void test('跨周补足同基金发售材料，基金代码为空或不同不得拼接', () => {
  assert.equal(szseSupportingHistoryStart('2026-10-12'), '2026-06-14');
  assert.equal(sameSzseFund(['180702'], '180702'), true);
  assert.equal(sameSzseFund('', ''), false);
  assert.equal(sameSzseFund(['180702'], ['180607']), false);
});

void test('深交所历史公告数组格式的基金简称可以正常读取', () => {
  assert.equal(
    firstSzseAnnouncementValue(['银华粤海水务水利REIT']),
    '银华粤海水务水利REIT',
  );
});
