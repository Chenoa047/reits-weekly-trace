import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIEF_RULES_VERSION,
  buildExchangeQuestionFallback,
  generateDeepSeekBrief,
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

void test('深交所问询与上交所反馈使用同一主题结构生成可核验保底简报', () => {
  const record = {
    ...submission,
    exchange: '深交所',
    shortName: '中金中国绿发REIT',
    status: '已问询',
    updateDate: '2026-09-18',
    progressType: '反馈/问询',
    files: [
      {
        label: '审核问询函原文',
        url: 'https://example.com/question.pdf',
        kind: '问询函',
        originalTitle: '关于中金中国绿发REIT申请文件的审核问询函',
        issuerRole: '交易所',
        content:
          '[第1页] 一、业务参与人资质及履职能力\n[第3页] 二、不动产合规情况\n[第6页] 三、项目经营与财务情况\n[第12页] 四、不动产估值\n[第13页] 五、基金运作与治理',
      },
    ],
  };
  const result = buildExchangeQuestionFallback(record);
  assert.ok(result);
  assert.equal(
    result.brief,
    '9月18日，深交所网站显示，中金中国绿发REIT项目获审核问询。审核问询函主要围绕业务参与人资质及履职能力、不动产项目合规性、项目经营与财务情况、资产评估与估值合理性、基金运作与治理机制等方面展开，要求进一步补充说明或充分披露。',
  );
  assert.deepEqual(
    result.evidence.map((item) => item.page),
    [1, 3, 6, 12, 13],
  );
});

void test('问询简报服务连续不可用时仍发布基于交易所原函的保底正文', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'non-secret-test-placeholder';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('unavailable', { status: 503 });
  };
  try {
    const result = await generateDeepSeekBrief({
      ...submission,
      exchange: '深交所',
      shortName: '中金中国绿发REIT',
      status: '已问询',
      updateDate: '2026-09-18',
      progressType: '反馈/问询',
      files: [
        {
          label: '审核问询函原文',
          url: 'https://example.com/question.pdf',
          kind: '问询函',
          originalTitle: '审核问询函',
          issuerRole: '交易所',
          content:
            '[第1页] 一、业务参与人资质及履职能力\n[第3页] 二、不动产合规情况\n[第6页] 三、项目经营与财务情况\n[第12页] 四、不动产估值\n[第13页] 五、基金运作与治理',
        },
      ],
    });
    assert.equal(calls, 2);
    assert.match(result.brief, /审核问询函主要围绕业务参与人资质及履职能力/);
    assert.equal(result.evidence.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
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

void test('非申报项目只有固定首句或零证据时不能计为完整简报', () => {
  const feedback = {
    ...submission,
    progressType: '反馈/问询',
    status: '已反馈',
  };
  assert.throws(
    () =>
      validateBrief(
        '9月15日，上交所网站显示，某REIT项目获反馈。',
        feedback,
        [],
      ),
    /no_verified_detail/,
  );
});

void test('模型输出达到上限后使用精简材料自动重试并累计用量', async () => {
  process.env.DEEPSEEK_API_KEY = 'non-secret-test-placeholder';
  const originalFetch = globalThis.fetch;
  const claim = '反馈意见主要关注项目合规性和估值合理性';
  const inputs: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const rawBody = init?.body;
    assert.equal(typeof rawBody, 'string');
    if (typeof rawBody !== 'string') throw new Error('missing_test_body');
    const body = JSON.parse(rawBody) as { input: string };
    inputs.push(body.input);
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        status: 'completed',
        output_text: JSON.stringify({
          brief: `9月15日，上交所网站显示，某REIT获反馈。${claim}。`,
          evidence: [{ claim, fileIndex: 1, quote: `${claim}。` }],
        }),
        usage: { input_tokens: 40, output_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const result = await generateDeepSeekBrief({
      ...submission,
      progressType: '反馈/问询',
      status: '已反馈',
      files: [
        {
          label: '反馈意见',
          url: 'https://example.com/question.pdf',
          kind: '反馈意见',
          originalTitle: '受理反馈意见',
          issuerRole: '交易所',
          content: `[第2页] ${claim}。\n${'补充材料'.repeat(10_000)}`,
        },
      ],
    });
    assert.equal(calls, 2);
    assert.equal(inputs[1].length < inputs[0].length, true);
    assert.equal(result.brief.includes(claim), true);
    assert.equal(result.inputTokens, 140);
    assert.equal(result.outputTokens, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

void test('询价阶段的数字只接受询价公告证据', () => {
  const record = {
    ...submission,
    progressType: '询价',
    status: '询价',
    files: [
      {
        label: '询价公告',
        url: 'https://example.com/pricing.pdf',
        kind: '询价',
        originalTitle: '基金份额询价公告',
        content: '[第3页] 本次询价区间为2.300元/份至2.500元/份。',
      },
      {
        label: '招募说明书',
        url: 'https://example.com/prospectus.pdf',
        kind: '招募说明书',
        originalTitle: '招募说明书',
        content: '[第8页] 预计发行价格为2.400元/份。',
      },
    ],
  };
  const claim = '询价公告披露，本次询价区间为2.300元/份至2.500元/份';
  const brief = `9月15日，上交所网站显示，某REIT项目发布基金份额询价公告。${claim}。`;
  assert.deepEqual(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim,
            fileIndex: 2,
            quote: '预计发行价格为2.400元/份。',
          },
        ],
      }),
      record,
    ),
    {
      brief: '9月15日，上交所网站显示，某REIT项目发布基金份额询价公告。',
      evidence: [],
    },
  );
  assert.equal(
    parseBriefResponse(
      JSON.stringify({
        brief,
        evidence: [
          {
            claim,
            fileIndex: 1,
            quote: '本次询价区间为2.300元/份至2.500元/份。',
          },
        ],
      }),
      record,
    ).brief,
    brief,
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

void test('询价和发售首句中的基金份额不是发行数据', () => {
  const pricing = {
    ...submission,
    progressType: '询价',
    status: '询价',
    files: [],
  };
  assert.doesNotThrow(() =>
    validateBrief(
      '9月15日，上交所网站显示，某REIT项目发布基金份额询价公告。',
      pricing,
    ),
  );
});

void test('认购结果简报按配售结构、网下、公众和募集结果排序', () => {
  const record = {
    ...submission,
    progressType: '认购结果',
    status: '认购结果',
    files: [
      {
        label: '认购结果公告',
        url: 'https://example.com/result.pdf',
        kind: '认购结果',
        originalTitle: '认购申请确认比例结果公告',
        content:
          '[第1页] 募集基金份额总额为4亿份，其中战略配售初始发售份额2.8亿份，网下发售初始发售份额0.84亿份，公众发售初始发售份额0.36亿份。\n[第2页] 网下投资者有效认购份额总数361.861亿份，对应配售比例为0.23%。\n[第3页] 公众投资者有效认购基金份额数量449.760亿份，有效认购申请确认比例为0.08%，认购倍数达到1249倍。\n[第4页] 基金份额认购价格为2.317元/份，募集基金份额总额为4亿份，最终募集规模为9.268亿元。',
      },
    ],
  };
  const structure =
    '募集基金份额总额为4亿份，其中战略配售初始发售份额2.8亿份，网下发售初始发售份额0.84亿份，公众发售初始发售份额0.36亿份';
  const offline =
    '网下投资者有效认购份额总数361.861亿份，对应配售比例为0.23%';
  const publicOffer =
    '公众投资者有效认购基金份额数量449.760亿份，有效认购申请确认比例为0.08%，认购倍数达到1249倍';
  const result =
    '基金份额认购价格为2.317元/份，募集基金份额总额为4亿份，最终募集规模为9.268亿元';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `9月15日，上交所网站显示，某REIT披露认购结果。${result}。${publicOffer}。${structure}。${offline}。`,
      evidence: [
        { claim: result, fileIndex: 1, quote: `${result}。` },
        { claim: publicOffer, fileIndex: 1, quote: `${publicOffer}。` },
        { claim: structure, fileIndex: 1, quote: `${structure}。` },
        { claim: offline, fileIndex: 1, quote: `${offline}。` },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `9月15日，上交所网站显示，某REIT项目发布认购申请确认比例的公告。${structure}。${offline}。${publicOffer}。${result}。`,
  );
  assert.deepEqual(
    parsed.evidence.map((item) => item.claim),
    [structure, offline, publicOffer, result],
  );
});

void test('认购结果可用公告中的价格和总份额计算最终募集规模', () => {
  const record = {
    ...submission,
    progressType: '认购结果',
    status: '认购结果',
    files: [
      {
        label: '认购结果公告',
        url: 'https://example.com/result.pdf',
        kind: '认购结果',
        originalTitle: '认购申请确认比例结果公告',
        content:
          '[第4页] 基金份额认购价格为2.317元/份，募集基金份额总额为4亿份。',
      },
    ],
  };
  const claim =
    '基金份额认购价格为2.317元/份，募集基金份额总额为4亿份，因此，最终募集规模为9.268亿元';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `9月15日，上交所网站显示，某REIT披露认购结果。${claim}。`,
      evidence: [
        {
          claim,
          fileIndex: 1,
          quote: '基金份额认购价格为2.317元/份，募集基金份额总额为4亿份。',
        },
      ],
    }),
    record,
  );
  assert.equal(parsed.brief.includes('最终募集规模为9.268亿元'), true);
});

void test('询价简报把招募说明书中的底层资产介绍放在最后', () => {
  const record = {
    ...submission,
    progressType: '询价',
    status: '询价',
    files: [
      {
        label: '询价公告',
        url: 'https://example.com/pricing.pdf',
        kind: '询价',
        originalTitle: '询价公告',
        content: '[第2页] 本次询价区间为2.30元/份至2.50元/份。',
      },
      {
        label: '招募说明书',
        url: 'https://example.com/prospectus.pdf',
        kind: '招募说明书',
        originalTitle: '招募说明书',
        content: '[第9页] 底层资产为甲项目，项目位于北京市。',
      },
    ],
  };
  const pricing = '询价公告披露，本次询价区间为2.30元/份至2.50元/份';
  const asset = '底层资产为甲项目，项目位于北京市';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `9月15日，上交所网站显示，某REIT发布询价公告。${asset}。${pricing}。`,
      evidence: [
        { claim: asset, fileIndex: 2, quote: `${asset}。` },
        {
          claim: pricing,
          fileIndex: 1,
          quote: '本次询价区间为2.30元/份至2.50元/份。',
        },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `9月15日，上交所网站显示，某REIT项目发布基金份额询价公告。${pricing}。${asset}。`,
  );
});

void test('回复反馈不发布单项估值参数的具体调整数值', () => {
  const record = {
    ...submission,
    progressType: '回复反馈',
    status: '已问询',
    exchange: '深交所',
    files: [
      {
        label: '审核问询函回复',
        url: 'https://example.com/reply.pdf',
        kind: '回复反馈',
        originalTitle: '审核问询函回复',
        content:
          '[第4页] 预测期出租率由96%调整为94%。\n[第5页] 项目合计评估值由26.97亿元下降至25.69亿元，整体估值下降4.75%。\n[第6页] 回复报告对项目历史合规手续和关联方租赁风险进行了回复。',
      },
    ],
  };
  const parameter = '预测期出租率由96%调整为94%';
  const valuation =
    '项目合计评估值由26.97亿元下降至25.69亿元，整体估值下降4.75%';
  const other = '回复报告对项目历史合规手续和关联方租赁风险进行了回复';
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `9月15日，深交所网站显示，某REIT答复问询。${parameter}。${other}。${valuation}。`,
      evidence: [
        { claim: parameter, fileIndex: 1, quote: `${parameter}。` },
        { claim: other, fileIndex: 1, quote: `${other}。` },
        { claim: valuation, fileIndex: 1, quote: `${valuation}。` },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `9月15日，深交所网站显示，某REIT项目就审核问询函进行了答复。${valuation}。${other}。`,
  );
  assert.equal(parsed.brief.includes(parameter), false);
});

void test('反馈问询的监管关注只能引用交易所原函，资产介绍只能引用招募说明书', () => {
  const concern = '审核问询函主要关注项目合规性和估值合理性';
  const asset = '根据招募说明书，项目底层资产位于北京市';
  const record = {
    ...submission,
    progressType: '反馈/问询',
    status: '已问询',
    exchange: '深交所',
    files: [
      {
        label: '审核问询函',
        url: 'https://example.com/question.pdf',
        kind: '问询函',
        originalTitle: '审核问询函',
        issuerRole: '交易所',
        content: `[第2页] ${concern}。`,
      },
      {
        label: '回复报告',
        url: 'https://example.com/reply.pdf',
        kind: '回复反馈',
        originalTitle: '审核问询函的回复',
        issuerRole: '原始权益人',
        content: `[第3页] ${concern}。`,
      },
      {
        label: '招募说明书',
        url: 'https://example.com/prospectus.pdf',
        kind: '招募说明书',
        originalTitle: '招募说明书草案',
        issuerRole: '披露主体',
        content: `[第8页] ${asset}。`,
      },
    ],
  };
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `9月15日，深交所网站显示，某REIT获问询。${concern}。${asset}。`,
      evidence: [
        { claim: concern, fileIndex: 2, quote: `${concern}。` },
        { claim: asset, fileIndex: 3, quote: `${asset}。` },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `9月15日，深交所网站显示，某REIT项目获审核问询。${asset}。`,
  );
  assert.deepEqual(parsed.evidence.map((item) => item.fileUrl), [
    'https://example.com/prospectus.pdf',
  ]);
});

void test('回复反馈的扩展事实只能引用原始权益人致交易所的回复PDF', () => {
  const exchangeClaim = '交易所问询函要求说明项目估值合理性';
  const replyClaim = '回复报告对项目历史合规手续和治理机制进行了系统性回复';
  const record = {
    ...submission,
    progressType: '回复反馈',
    status: '已反馈',
    files: [
      {
        label: '受理反馈意见',
        url: 'https://example.com/question.pdf',
        kind: '反馈意见',
        originalTitle: '受理反馈意见',
        issuerRole: '交易所',
        content: `[第2页] ${exchangeClaim}。`,
      },
      {
        label: '反馈意见答复',
        url: 'https://example.com/reply.pdf',
        kind: '回复反馈',
        originalTitle: '受理反馈意见的答复',
        issuerRole: '原始权益人',
        content: `[第6页] ${replyClaim}。`,
      },
    ],
  };
  const parsed = parseBriefResponse(
    JSON.stringify({
      brief: `9月15日，上交所网站显示，某REIT回复反馈。${exchangeClaim}。${replyClaim}。`,
      evidence: [
        { claim: exchangeClaim, fileIndex: 1, quote: `${exchangeClaim}。` },
        { claim: replyClaim, fileIndex: 2, quote: `${replyClaim}。` },
      ],
    }),
    record,
  );
  assert.equal(
    parsed.brief,
    `9月15日，上交所网站显示，某REIT项目就反馈意见进行了答复。${replyClaim}。`,
  );
  assert.deepEqual(parsed.evidence.map((item) => item.fileUrl), [
    'https://example.com/reply.pdf',
  ]);
});
