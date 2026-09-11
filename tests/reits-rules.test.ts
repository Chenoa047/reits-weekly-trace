import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementStage,
  classifyDocument,
  inferProjectStage,
  selectStageFiles,
  type ReitsSourceFile,
} from '../lib/reits-rules.ts';

function file(
  originalTitle: string,
  section = '项目材料',
  publishedAt = '2026-09-01',
): ReitsSourceFile {
  const kind = classifyDocument(originalTitle);
  return {
    label: originalTitle,
    originalTitle,
    kind,
    section,
    publishedAt,
    url: `https://example.com/${publishedAt}.pdf`,
  };
}

void test('同一审核状态按问询栏目中的文件角色区分问询和回复', () => {
  const query = file('关于某项目挂牌申请文件的审核问询函.pdf', '问询与回复');
  const reply = file(
    '关于某项目挂牌申请文件的审核问询函的回复.pdf',
    '问询与回复',
  );
  assert.equal(inferProjectStage('已问询', [query]), '反馈/问询');
  assert.equal(inferProjectStage('已问询', [query, reply]), '回复反馈');
  assert.deepEqual(
    selectStageFiles('回复反馈', [query, reply]).map((item) => item.kind),
    ['问询函', '回复反馈'],
  );
});

void test('已受理与注册生效只选择日期最新的招募说明书', () => {
  const oldFile = file('招募说明书草案.pdf', '项目申报材料', '2026-07-01');
  const latestFile = file(
    '招募说明书（更新）.pdf',
    '项目申报材料',
    '2026-09-01',
  );
  assert.deepEqual(selectStageFiles('受理', [oldFile, latestFile]), [
    latestFile,
  ]);
  assert.deepEqual(selectStageFiles('注册生效', [oldFile, latestFile]), [
    latestFile,
  ]);
});

void test('申报不展示附件，上市展示规定的四类原文件', () => {
  const files = [
    file('上市交易提示性公告.pdf'),
    file('招募说明书（更新）.pdf'),
    file('基金份额发售公告.pdf'),
    file('认购申请确认比例结果的公告.pdf'),
    file('基金合同.pdf'),
  ];
  assert.deepEqual(selectStageFiles('申报', files), []);
  assert.deepEqual(
    selectStageFiles('上市', files).map((item) => item.kind),
    ['上市', '招募说明书', '发售', '认购结果'],
  );
});

void test('只有四类一级市场公告进入公告阶段', () => {
  assert.equal(announcementStage('某基金基金份额询价公告'), '询价');
  assert.equal(announcementStage('某基金基金份额发售公告'), '发售');
  assert.equal(
    announcementStage('某基金认购申请确认比例结果的公告'),
    '认购结果',
  );
  assert.equal(announcementStage('某基金上市交易提示性公告'), '上市');
  assert.equal(announcementStage('某基金召开业绩说明会的公告'), null);
});
