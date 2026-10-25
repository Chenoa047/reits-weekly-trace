import { REPLY_TOPICS } from './reply-topics.ts';
import { classifyDocument } from './reits-rules.ts';

type SourceFile = { kind: string; originalTitle: string; issuerRole?: string; url: string; content?: string };
type Evidence = { fileUrl: string; page: number; quote: string; claim: string };
type Fact = { claim: string; evidence: Evidence[] };

// Keep page markers and answer continuations; remove the questions reproduced before each answer.
export function replyAnswerText(text: string) {
  const source = text.normalize('NFKC').replace(/\s/g, '');
  let answer = !/(?:答复|回复)[:：]/.test(source);
  if (answer && /请(?:管理人|基金管理人|评估机构|律师|你公司|贵公司)/.test(source)) return '';
  const markers = /(?:答复|回复)[:：]|(?<!\d)(?:\d{1,2}[.、]|\([一二三四五六七八九十\d]+\))(?:关于|根据申报材料)|请(?:管理人|基金管理人|评估机构|律师|你公司|贵公司)/g;
  let start = 0;
  const kept: string[] = [];
  const keep = (end: number) => {
    if (!answer || end <= start) return;
    const part = source.slice(start, end);
    const page = source.slice(0, start).match(/\[第\d+页\]/g)?.at(-1) || '';
    kept.push(`${page}${part}`);
  };
  for (const marker of source.matchAll(markers)) {
    keep(marker.index);
    answer = /^(?:答复|回复)[:：]/.test(marker[0]);
    start = marker.index + marker[0].length;
  }
  keep(source.length);
  return kept.join('\n');
}

function replyPages(files: SourceFile[]) {
  return files.filter(file => file.kind === '回复反馈' && file.issuerRole !== '交易所' &&
    !['反馈意见', '问询函'].includes(classifyDocument(file.originalTitle))).flatMap(file =>
    replyAnswerText(file.content || '').split(/(?=\[第\d+页\])/).map(text => ({
      fileUrl: file.url, page: Number(text.match(/^\[第(\d+)页\]/)?.[1]), text: text.replace(/^\[第\d+页\]/, ''),
    })).filter(part => part.page));
}

export function replyValuationFacts(files: SourceFile[]): Fact[] {
  const pages = replyPages(files);
  const valuations: Fact[] = [];
  const terms = new Set<string>();
  for (const part of pages) {
    const pattern = /(?:(?:不动产项目|项目|[一二三四五六七八九十\d]+个项目)?(?:整体|合计)(?:的)?(?:评估值|估值|评估价值)|(?:不动产项目|本项目)(?:的)?(?:评估值|估值|评估价值)|(?<=^|[。；，：,;:])(?:评估值|估值|评估价值))[^。；;]{0,30}?(?:由|从)(?:首次申报(?:时点|时)?|申报时点)?的?([\d,.]+)(亿|万)元?(调整为|下降至|降至|下调至|上升至|升至|增至|上调至|(?:下降|下调|减少|增加|上调|上升)[\d,.]+(?:亿|万)元(?:\([+-]?\d+(?:\.\d+)?%\))?(?:至|为))([\d,.]+)(亿|万)(?:元|(?=[，,。；;：:]|$))([^。；;]*)/g;
    for (const match of part.text.matchAll(pattern)) {
      const tail = match[6].split(/[,，][^,，。；;:]{0,30}(?:如下|下表|详见)|[：:]/)[0];
      const before = Number(match[1].replace(/,/g, '')) * (match[2] === '亿' ? 1e8 : 1e4);
      const after = Number(match[4].replace(/,/g, '')) * (match[5] === '亿' ? 1e8 : 1e4);
      if (!before || !after || before === after) continue;
      if (/(?:下降|下调|减少|降至)/.test(match[3]) && after > before || /(?:上升|上调|增加|升至|增至)/.test(match[3]) && after < before)
        throw new Error('conflicting_reply_valuation');
      const beforeRounding = 0.5 * 10 ** -(match[1].split('.')[1]?.length || 0) * (match[2] === '亿' ? 1e8 : 1e4);
      const afterRounding = 0.5 * 10 ** -(match[4].split('.')[1]?.length || 0) * (match[5] === '亿' ? 1e8 : 1e4);
      const ratio = tail.match(/(降幅|增幅|涨幅|调整幅度|变动比例|变动幅度|下调幅度|上调幅度|下调|上调|(?:整体)?估值(?:下降|上升))(?:为|约为|约)?([+-]?\d+(?:\.\d+)?)%/) ||
        match[3].match(/(\()([+-]?\d+(?:\.\d+)?)%\)/);
      if (ratio) {
        const expected = (after - before) / before * 100;
        const actual = Number(ratio[2]);
        const signed = /调整|变动|\(/.test(ratio[1]);
        const precision = ratio[2].split('.')[1]?.length || 0;
        const signedActual = signed || expected > 0 ? actual : -actual;
        const lower = ((after - afterRounding) / (before + beforeRounding) - 1) * 100;
        const upper = ((after + afterRounding) / (before - beforeRounding) - 1) * 100;
        if (signedActual < lower - 0.5 * 10 ** -precision || signedActual > upper + 0.5 * 10 ** -precision ||
          /降幅|下降|下调/.test(ratio[1]) && after > before || /增幅|涨幅|上升|上调/.test(ratio[1]) && after < before)
          throw new Error('conflicting_reply_valuation');
      }
      const delta = `${match[3]}${tail}`.match(/(?:下降|下调|减少|增加|上调|上升)([\d,.]+)(亿|万)元/);
      if (delta) {
        const unit = delta[2] === '亿' ? 1e8 : 1e4;
        const rounding = 0.5 * 10 ** -(delta[1].split('.')[1]?.length || 0) * unit;
        if (Math.abs(Number(delta[1].replace(/,/g, '')) * unit - Math.abs(after - before)) > beforeRounding + afterRounding + rounding)
          throw new Error('conflicting_reply_valuation');
      }
      terms.add(`${before}:${after}`);
      if (terms.size > 1) throw new Error('conflicting_reply_valuation');
      if (valuations.length) continue;
      const quote = match[0].slice(0, match[0].length - match[6].length) + tail;
      const claim = `${/^(?:不动产项目|本项目|项目|[一二三四五六七八九十\d]+个项目)/.test(quote) ? '' : '不动产项目'}${quote.replace(/(?<!\d),|,(?!\d)/g, '，')}`;
      valuations.push({ claim, evidence: [{ fileUrl: part.fileUrl, page: part.page, quote, claim }] });
    }
  }
  const parameters = [
    ['出租率', /出租率/], ['租金假设', /租金假设/], ['租金增长率', /(?:固定)?租金增长率/],
    ['租金收缴率', /(?:租金)?收缴率/], ['长期增长率', /长期增长率/],
    ['吞吐量上限', /吞吐量上限/], ['吞吐量基数', /吞吐量基数/], ['港口作业包干费费率增速', /港口作业包干费费率增速/], ['折现率', /(?:税前)?折现率/],
  ] as const;
  const changes: Array<{ label: string; fileUrl: string; page: number; quote: string }> = [];
  for (const [label, pattern] of parameters) {
    for (const part of pages) {
      const sentence = part.text.split(/[。；]/).find(sentence => sentence.length <= 240 && pattern.test(sentence) && /(?:将|已).*(?:调整|更新)|(?:调整|更新).*(?:假设|参数)|(?:假设|参数).*(?:调整|更新)/.test(sentence));
      const discount = label === '折现率' ? part.text.match(/(?:税前)?折现率(\d+(?:\.\d+)?)%(\d+(?:\.\d+)?)%/) : null;
      const quote = sentence || (discount && discount[1] !== discount[2] ? discount[0] : '');
      if (!quote) continue;
      changes.push({ label, fileUrl: part.fileUrl, page: part.page, quote });
      break;
    }
  }
  if (!changes.length) return valuations;
  const claim = `回复报告对${changes.map(change => change.label).join('、')}等估值参数作出调整`;
  return [{ claim, evidence: changes.map(({ label: _label, ...source }) => ({ ...source, claim })) }, ...valuations];
}

export function replyOtherFacts(files: SourceFile[]): Fact[] {
  const pages = replyPages(files);
  const topics: Array<{ label: string; fileUrl: string; page: number; quote: string }> = [];
  for (const { label, pattern } of REPLY_TOPICS) {
    let best: { label: string; fileUrl: string; page: number; quote: string; score: number } | undefined;
    for (const part of pages) {
      const match = new RegExp(label).exec(part.text) || pattern.exec(part.text);
      if (!match) continue;
      const start = Math.max(part.text.lastIndexOf('。', match.index) + 1, match.index - 40);
      const quote = part.text.slice(start, Math.min(part.text.indexOf('。', match.index) < 0 ? part.text.length : part.text.indexOf('。', match.index), match.index + 100)).replace(/^\[第\d+页\]/, '');
      if (quote.length < 8 || !pattern.test(quote) || /^[一二三四五六七八九十]+[、.]\S{0,35}$/.test(quote)) continue;
      const score = (quote.includes(label) ? 4 : 0) + (/已|认为|承诺|本基金|管理人|本公司|设置|制定|补充|符合|通过|实施|明确/.test(quote) ? 2 : 0);
      if (!best || score > best.score) best = { label, fileUrl: part.fileUrl, page: part.page, quote, score };
    }
    if (best) {
      const { score: _score, ...source } = best;
      topics.push(source);
    }
  }
  if (!topics.length) return [];
  const claim = `此外，回复报告还就${topics.map(topic => topic.label).join('、')}等事项作出说明`;
  return [{ claim, evidence: topics.map(({ label: _label, ...source }) => ({ ...source, claim })) }];
}
