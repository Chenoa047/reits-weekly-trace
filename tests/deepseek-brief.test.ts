import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIEF_RULES_VERSION,
  isBriefDisplayable,
  isCurrentBriefDisplayable,
  needsBriefRegeneration,
  parseBriefResponse,
  validateBrief,
} from '../lib/deepseek.ts';

const submission = {
  exchange: '上交所',
  shortName: '某REIT',
  status: '已申报',
  progressType: '申报',
  offeringType: '首发' as const,
  updateDate: '2026-09-15',
  originator: '某公司',
  brief: '',
  sourceHtml: '上交所项目动态显示已申报，原始权益人为某公司。',
  files: [],
};

void test('申报简报不需要为凑字数重复说明材料未披露', () => {
  assert.doesNotThrow(() =>
    validateBrief(
      '9月15日，上交所网站显示，某REIT已申报，原始权益人为某公司。',
      submission,
    ),
  );
});

void test('句子未写完的简报拒绝发布', () => {
  assert.throws(
    () =>
      validateBrief(
        '9月15日，上交所网站显示，某REIT已申报，涉及申请',
        submission,
      ),
    /incomplete_sentence/,
  );
  assert.equal(
    isBriefDisplayable(
      '9月15日，上交所网站显示，某REIT已申报，涉及申请',
      '申报',
    ),
    false,
  );
});

void test('反馈意见不能写成长篇逐项罗列', () => {
  const feedback = {
    ...submission,
    progressType: '反馈/问询',
    files: [
      {
        label: '反馈意见',
        url: 'https://example.com/a.pdf',
        kind: '反馈意见',
        originalTitle: '反馈意见',
        content: '监管关注资产合规、估值和信息披露。',
      },
    ],
  };
  const verbose = `9月15日，上交所就某REIT申请出具反馈意见，重点关注资产合规、估值和信息披露。${'交易所要求逐项补充说明资产权属、运营情况及各项财务指标。'.repeat(15)}`;
  assert.throws(() => validateBrief(verbose, feedback), /invalid_length/);
  assert.equal(isBriefDisplayable(verbose, '反馈/问询'), false);
});

void test('已受理简报的数字不能仅来自项目动态页', () => {
  const accepted = {
    ...submission,
    progressType: '受理',
    sourceHtml: '项目动态页显示已受理，评估值10亿元。',
    files: [
      {
        label: '招募说明书',
        url: 'https://example.com/a.pdf',
        kind: '招募说明书',
        originalTitle: '招募说明书',
        content: '原始权益人为某公司，底层资产为某项目。',
      },
    ],
  };
  assert.throws(
    () =>
      validateBrief(
        '9月15日，上交所网站显示，某REIT已受理。招募说明书披露底层资产为某项目，原始权益人为某公司，评估值10亿元，项目的其他核心参数仍需依据招募说明书正文核验。',
        accepted,
      ),
    /unsupported_number/,
  );
});

void test('来源未变时旧规则或失格简报仍要自动重生成', () => {
  const current = {
    ...submission,
    brief: '9月15日，上交所网站显示，某REIT已申报，原始权益人为某公司。',
    briefRulesVersion: BRIEF_RULES_VERSION,
  };
  assert.equal(needsBriefRegeneration(current, submission), false);
  assert.equal(
    needsBriefRegeneration(
      { ...current, briefRulesVersion: undefined },
      submission,
    ),
    true,
  );
  assert.equal(
    needsBriefRegeneration({ ...current, brief: '涉及申请' }, submission),
    true,
  );
  assert.equal(
    isCurrentBriefDisplayable(current.brief, '申报', BRIEF_RULES_VERSION),
    true,
  );
  assert.equal(
    isCurrentBriefDisplayable(current.brief, '申报', '旧规则'),
    false,
  );
});

void test('扩募回复简报只在原文件给出变化数据时使用数字', () => {
  const reply = {
    ...submission,
    updateDate: '2026-10-14',
    progressType: '回复反馈',
    offeringType: '扩募' as const,
    files: [
      {
        label: '交易所反馈',
        url: 'https://example.com/q.pdf',
        kind: '反馈意见',
        originalTitle: '反馈意见',
        content: '交易所要求说明估值参数。',
      },
      {
        label: '原始权益人答复',
        url: 'https://example.com/r.pdf',
        kind: '回复反馈',
        originalTitle: '反馈意见的答复',
        content:
          '评估基准日更新后，项目评估值由10.37亿元降至9.89亿元，下降0.48亿元，降幅为4.63%。',
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateBrief(
      '10月14日，上交所显示，某REIT扩募项目就受理反馈意见作出答复。答复文件披露，新增资产评估基准日更新后，评估值由10.37亿元降至9.89亿元，下降0.48亿元，降幅为4.63%。',
      reply,
    ),
  );
});

void test('同屏核对依据只能定位到原文件实际页码和原文', () => {
  const record = {
    ...submission,
    progressType: '反馈/问询',
    files: [
      {
        label: '审核问询函',
        url: 'https://example.com/question.pdf',
        kind: '问询函',
        originalTitle: '审核问询函',
        content: '[第6页] 项目基本情况。\n[第7页] 请说明资产权属和估值依据。',
      },
    ],
  };
  const brief =
    '9月15日，上交所网站显示，某REIT获交易所问询。问询函主要关注资产权属和估值依据。';
  const claim = '问询函主要关注资产权属和估值依据';
  const output = JSON.stringify({
    brief,
    evidence: [{ claim, fileIndex: 1, quote: '请说明资产权属和估值依据。' }],
  });
  const valid = parseBriefResponse(output, record);
  assert.equal(
    valid.brief,
    '9月15日，上交所网站显示，某REIT项目获反馈。问询函主要关注资产权属和估值依据。',
  );
  assert.deepEqual(valid.evidence, [
    {
      fileUrl: 'https://example.com/question.pdf',
      page: 7,
      claim,
      quote: '请说明资产权属和估值依据。',
    },
  ]);
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [{ claim, fileIndex: 1, quote: '文件里并没有这个句子。' }],
      }),
      record,
    ),
    {
      brief: '9月15日，上交所网站显示，某REIT项目获反馈。',
      evidence: [],
    },
  );
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim: '简报没有这样的句子',
            fileIndex: 1,
            quote: '请说明资产权属和估值依据。',
          },
        ],
      }),
      record,
    ).evidence,
    [],
  );
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({ brief: '简报。', evidence: [] }),
      record,
    ),
    {
      brief: '9月15日，上交所网站显示，某REIT项目获反馈。',
      evidence: [],
    },
  );
});

void test('非申报简报的每个事实句都必须逐句绑定原文证据', () => {
  const record = {
    ...submission,
    progressType: '受理',
    status: '已受理',
    files: [
      {
        label: '招募说明书',
        url: 'https://example.com/prospectus.pdf',
        kind: '招募说明书',
        originalTitle: '招募说明书',
        content: '[第10页] 原始权益人为某公司。\n[第11页] 底层资产为甲项目。',
      },
    ],
  };
  const brief =
    '9月15日，上交所网站显示，某REIT项目状态为“已受理”。原始权益人为某公司。底层资产为甲项目。';
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim: '原始权益人为某公司',
            fileIndex: 1,
            quote: '原始权益人为某公司。',
          },
        ],
      }),
      record,
    ),
    {
      brief:
        '9月15日，上交所网站显示，某REIT项目状态为“已受理”。原始权益人为某公司。',
      evidence: [
        {
          fileUrl: 'https://example.com/prospectus.pdf',
          page: 10,
          claim: '原始权益人为某公司',
          quote: '原始权益人为某公司。',
        },
      ],
    },
  );
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim: '原始权益人为某公司',
            fileIndex: 1,
            quote: '原始权益人为某公司。',
          },
          {
            claim: '底层资产为甲项目',
            fileIndex: 1,
            quote: '底层资产为甲项目。',
          },
        ],
      }),
      record,
    ).evidence.map((item) => item.page),
    [10, 11],
  );
});

void test('局部短语不能冒充整句证据', () => {
  const record = {
    ...submission,
    progressType: '反馈/问询',
    files: [
      {
        label: '问询函',
        url: 'https://example.com/q.pdf',
        kind: '问询函',
        originalTitle: '问询函',
        content: '[第2页] 请说明资产权属。',
      },
    ],
  };
  const brief =
    '9月15日，上交所网站显示，某REIT获问询。问询函主要关注资产权属。';
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim: '主要关注资产权属',
            fileIndex: 1,
            quote: '请说明资产权属。',
          },
        ],
      }),
      record,
    ),
    { brief: '9月15日，上交所网站显示，某REIT项目获反馈。', evidence: [] },
  );
});

void test('事实句中的数字必须由该句绑定的原文证据支持', () => {
  const record = {
    ...submission,
    progressType: '发售',
    status: '发售',
    files: [
      {
        label: '发售公告',
        url: 'https://example.com/sale.pdf',
        kind: '发售',
        originalTitle: '基金份额发售公告',
        content: '[第3页] 认购价格为2.317元/份，发售份额总额为4亿份。',
      },
    ],
  };
  const brief =
    '9月15日，上交所网站显示，某REIT发布基金份额发售公告。公告披露认购价格为2.317元/份，发售份额总额为5亿份。';
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim: '公告披露认购价格为2.317元/份，发售份额总额为5亿份',
            fileIndex: 1,
            quote: '认购价格为2.317元/份，发售份额总额为4亿份。',
          },
        ],
      }),
      record,
    ),
    {
      brief: '9月15日，上交所网站显示，某REIT项目发布基金份额发售公告。',
      evidence: [],
    },
  );
});

void test('首句必须包含日期交易所项目简称和本次动作', () => {
  assert.throws(
    () =>
      validateBrief(
        '上交所网站显示，某REIT已申报，原始权益人为某公司。',
        submission,
      ),
    /invalid_opening/,
  );
  const accepted = {
    ...submission,
    progressType: '受理',
    status: '已受理',
    files: [
      {
        label: '招募说明书',
        url: 'https://example.com/a.pdf',
        kind: '招募说明书',
        originalTitle: '招募说明书',
        content: '原始权益人为某公司。',
      },
    ],
  };
  assert.throws(
    () =>
      validateBrief(
        '9月15日，上交所网站显示，某REIT项目状态为“已受理”，评估值为10亿元。原始权益人为某公司。',
        accepted,
      ),
    /opening_contains_details/,
  );
});
