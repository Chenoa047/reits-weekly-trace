import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementStage,
  classifyDocument,
  inferProjectStage,
  missingRequiredMaterial,
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
    ['回复反馈'],
  );
});

void test('回复阶段用两类文件识别进度，但只把原始权益人回复交给撰写模型', () => {
  const question = file('关于某项目挂牌申请文件的审核问询函.pdf', '问询与回复');
  const reply = file('关于某项目挂牌申请文件的审核问询函的回复.pdf', '问询与回复');
  question.issuerRole = '交易所';
  reply.issuerRole = '原始权益人';
  assert.deepEqual(missingRequiredMaterial('回复反馈', [reply]), []);
  assert.deepEqual(missingRequiredMaterial('回复反馈', [question, reply]), []);
  assert.equal(inferProjectStage('已问询', [question, reply]), '回复反馈');
  assert.equal(inferProjectStage('已问询', [question, { ...reply, issuerRole: '交易所' }]), '反馈/问询');
  assert.deepEqual(selectStageFiles('回复反馈', [question, reply]), [reply]);
});

void test('反馈问询只用交易所原函归纳问题，招募说明书仅作为资产介绍补充', () => {
  const question = file('关于某项目挂牌申请文件的审核问询函.pdf', '问询与回复');
  const reply = file('关于某项目挂牌申请文件的审核问询函的回复.pdf', '问询与回复');
  const prospectus = file('招募说明书草案.pdf', '项目申报材料');
  question.issuerRole = '交易所';
  reply.issuerRole = '原始权益人';
  assert.deepEqual(selectStageFiles('反馈/问询', [question, reply, prospectus]), [
    question,
    prospectus,
  ]);
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

void test('询价、发售、认购结果只选本阶段公告及最新招募说明书', () => {
  const files = [
    file('基金份额询价公告.pdf'),
    file('基金份额发售公告.pdf'),
    file('认购申请确认比例结果的公告.pdf'),
    file('招募说明书（旧）.pdf', '项目申报材料', '2026-08-01'),
    file('招募说明书（更新）.pdf', '项目申报材料', '2026-09-01'),
  ];
  for (const stage of ['询价', '发售', '认购结果']) {
    assert.deepEqual(
      selectStageFiles(stage, files).map((item) => item.kind),
      [stage, '招募说明书'],
    );
    assert.equal(selectStageFiles(stage, files)[1].publishedAt, '2026-09-01');
    assert.deepEqual(missingRequiredMaterial(stage, [files[4]]), [stage]);
  }
});

void test('受理、注册生效必须有招募说明书，反馈必须有交易所文件', () => {
  assert.deepEqual(missingRequiredMaterial('受理', []), ['招募说明书']);
  assert.deepEqual(missingRequiredMaterial('注册生效', []), ['招募说明书']);
  assert.deepEqual(missingRequiredMaterial('反馈/问询', [file('关于某项目审核问询函.pdf', '问询与回复')]), []);
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

void test('交易所信息披露中的四类首发和扩募标题均能识别', () => {
  const titles = [
    ['某基金基金份额询价公告', '询价'],
    ['某REIT：某封闭式基础设施证券投资基金基金份额发售公告', '发售'],
    ['某REIT扩募：某封闭式基础设施证券投资基金认购申请确认比例结果的公告', '认购结果'],
    ['某REIT：某封闭式基础设施证券投资基金上市交易提示性公告', '上市'],
    ['某封闭式基础设施证券投资基金上市交易性提示公告', '上市'],
  ] as const;
  for (const [title, stage] of titles) assert.equal(announcementStage(title), stage);
});
