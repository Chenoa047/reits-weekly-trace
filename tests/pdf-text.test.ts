import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPdfTextTooSparse,
  selectRelevantText,
} from '../lib/pdf-text.ts';

void test('长文件优先保留与当前阶段相关的后部原文而不是只截取首页', () => {
  const front = `[第1页] ${'无关目录'.repeat(2_000)}`;
  const relevant = '[第88页] 本次发售认购价格为3.25元/份，发售时间为9月20日。';
  const text = `${front}\n${'普通内容'.repeat(2_000)}\n${relevant}`;
  const selected = selectRelevantText(text, '发售', 4_000);
  assert.match(selected, /\[第88页\]/);
  assert.match(selected, /认购价格为3\.25元\/份/);
});

void test('询价所用长招募说明书保留资产和原始权益人摘录', () => {
  const front = `[第1页] ${'目录'.repeat(12_000)}`;
  const asset = '[第90页] 底层资产为甲园区，位于北京市，建筑面积10万平方米；项目原始权益人为甲公司。';
  const selected = selectRelevantText(`${front}\n${asset}`, '询价资产', 5_000);
  assert.match(selected, /\[第90页\]/);
  assert.match(selected, /建筑面积10万平方米/);
  assert.match(selected, /原始权益人为甲公司/);
});

void test('发售长公告与招募说明书保留各自需要的事实', () => {
  const front = `[第1页] ${'目录'.repeat(7_000)}`;
  const notice =
    '[第20页] 证监许可〔2026〕1234号，基金代码180001。\n' +
    '[第21页] 认购价格4.20元/份，运作方式为契约型封闭式，存续期限30年，发售份额总额2亿份。\n' +
    '[第22页] 战略配售初始份额1.2亿份，网下发售初始份额0.6亿份，公众投资者初始份额0.2亿份。';
  const selectedNotice = selectRelevantText(`${front}\n${notice}`, '发售', 9_000);
  assert.match(selectedNotice, /证监许可〔2026〕1234号/);
  assert.match(selectedNotice, /认购价格4\.20元\/份/);
  assert.match(selectedNotice, /战略配售初始份额1\.2亿份/);

  const asset = '[第80页] 底层资产为甲园区，建筑面积8万平方米，原始权益人为甲公司。';
  const selectedAsset = selectRelevantText(`${front}\n${asset}`, '发售资产', 5_000);
  assert.match(selectedAsset, /底层资产为甲园区/);
  assert.match(selectedAsset, /原始权益人为甲公司/);
});

void test('长反馈函同时保留一级标题和最后的其他反馈意见', () => {
  const text =
    `[第1页] ${'导言'.repeat(4_000)}\n` +
    '[第2页] 一、业务参与人资质及履职能力。\n' +
    `[第3页] ${'细分问题'.repeat(4_000)}\n` +
    '[第4页] 二、不动产合规情况。\n' +
    `[第5页] ${'细分问题'.repeat(4_000)}\n` +
    '[第6页] 三、其他反馈意见。请补充说明程序合规与信息披露事项。';
  const selected = selectRelevantText(text, '反馈/问询', 9_000);
  assert.match(selected, /一、业务参与人资质及履职能力/);
  assert.match(selected, /二、不动产合规情况/);
  assert.match(selected, /三、其他反馈意见。请补充说明程序合规与信息披露事项/);
  assert.ok(selected.indexOf('一、业务参与人') < selected.indexOf('三、其他反馈意见'));
});

void test('扫描型问询函只有页码或零星字符时必须启用OCR', () => {
  const sparse = Array.from({ length: 15 }, (_, index) =>
    index === 14 ? `[第15页] 3` : `[第${index + 1}页]`,
  ).join('\n');
  assert.equal(isPdfTextTooSparse(sparse, 15), true);
});

void test('已有足量可检索正文的PDF不重复启用OCR', () => {
  const text = Array.from(
    { length: 5 },
    (_, index) =>
      `[第${index + 1}页] 审核问询函主要关注业务参与人资质、不动产合规、项目经营与财务、资产评估及基金治理。`,
  ).join('\n');
  assert.equal(isPdfTextTooSparse(text, 5), false);
});
