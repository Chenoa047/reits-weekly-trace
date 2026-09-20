import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstSzseAnnouncementValue,
  szseAnnouncementHistoryBody,
} from '../lib/szse-announcements.ts';

void test('深交所历史公告查询包含周一起始日和周日结束日', () => {
  assert.deepEqual(szseAnnouncementHistoryBody('2026-09-14', '2026-09-20', 1), {
    seDate: ['2026-09-14', '2026-09-20'],
    channelCode: ['reits-xxpl'],
    pageSize: 50,
    pageNum: 1,
  });
});

void test('深交所历史公告数组格式的基金简称可以正常读取', () => {
  assert.equal(
    firstSzseAnnouncementValue(['银华粤海水务水利REIT']),
    '银华粤海水务水利REIT',
  );
});
