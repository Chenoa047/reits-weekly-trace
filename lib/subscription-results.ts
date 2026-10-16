type SourceFile = { kind: string; url: string; content?: string };
type Fact = { value: number; quote: string; page: number; fileUrl: string };
export type SubscriptionFact = { claim: string; evidence: Array<Omit<Fact, 'value'> & { claim: string }> };

// Keep each match on its original page. No values come from project names or sample briefs.
function find(files: SourceFile[], pattern: string, shares = false, suffix = ''): Fact | undefined {
  for (const file of files) {
    for (const part of (file.content || '').split(/(?=\[第\d+页\])/)) {
      const page = Number(part.match(/^\[第(\d+)页\]/)?.[1]);
      if (!page) continue;
      const match = new RegExp(`${pattern}([\\d,]+(?:\\.\\d+)?)(亿|万)?${shares ? '份' : suffix}`).exec(part.normalize('NFKC').replace(/\s/g, ''));
      if (!match) continue;
      const value = Number(match[1].replace(/,/g, '')) * (match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : 1);
      if (!Number.isFinite(value) || value <= 0) continue;
      return { value, quote: match[0], page, fileUrl: file.url };
    }
  }
}

function format(value: number, digits = 3) {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

export function subscriptionResultFacts(files: SourceFile[]): SubscriptionFact[] {
  const results = files.filter(file => file.kind === '认购结果');
  const offerings = files.filter(file => file.kind === '发售');
  const total = find(results, '(?:募集基金份额总额|基金份额总额|发售份额总额)(?:为|:|：)?', true);
  const strategic = find(results, '(?:初始战略配售(?:发售)?(?:基金)?份额(?:数量)?|战略配售初始(?:发售)?(?:基金)?份额(?:数量)?)(?:为|:|：)?', true);
  const offline = find(results, '(?:网下发售的初始基金份额数量|网下(?:发售)?初始(?:发售)?(?:基金)?份额)(?:为|:|：)?', true);
  const publicOffer = find(results, '(?:公众投资者认购的初始基金份额数量|公众(?:投资者)?(?:发售)?初始(?:发售)?(?:基金)?份额)(?:为|:|：)?', true);
  const offlineEffective = find(results, '网下投资者[^。]{0,200}?有效认购(?:基金)?份额(?:总数|数量|总额)?(?:为|:|：)?', true);
  const publicEffective = find(results, '公众投资者的?有效认购(?:基金)?份额(?:总数|数量|总额)?(?:为|:|：)?', true);
  const offlineRatio = find(results, '网下投资者有效认购申请(?:实际|最终)?确认比例(?:[（(]即配售比例[）)])?(?:为|:|：)?', false, '%') ||
    find(results, '网下投资者[^。]{0,120}?对应配售比例(?:为|:|：)?', false, '%');
  const publicRatio = find(results, '公众投资者有效认购申请(?:实际|最终)?确认比例(?:[（(]即配售比例[）)])?(?:为|:|：)?', false, '%') ||
    find(results, '公众投资者[^。]{0,120}?有效认购申请(?:实际|最终)?确认比例(?:[（(]即配售比例[）)])?(?:为|:|：)?', false, '%');
  const strategicRatio = find(results, '战略投资者有效认购申请(?:实际|最终)?确认比例(?:为|:|：)?', false, '%');
  const multiple = find(results, '公众投资者[^。]{0,160}?认购倍数(?:达到|约为|为|约)?', false, '倍');
  const resultPrice = find(results, '(?:基金份额)?认购价格(?:为|:|：)?', false, '元/份');
  const offeringPrice = find(offerings, '(?:基金份额)?认购价格(?:为|:|：)?', false, '元/份');
  if (resultPrice && offeringPrice && Math.abs(resultPrice.value - offeringPrice.value) > 1e-8)
    throw new Error('conflicting_subscription_terms');
  const price = resultPrice || offeringPrice;
  if (total && strategic && offline && publicOffer && Math.abs(strategic.value + offline.value + publicOffer.value - total.value) > 1)
    throw new Error('conflicting_subscription_terms');
  if (multiple && publicEffective && publicOffer) {
    const precision = multiple.quote.match(/\d+(?:\.(\d+))?倍$/)?.[1]?.length || 0;
    if (Math.abs(multiple.value - publicEffective.value / publicOffer.value) >= 0.5 * 10 ** -precision)
      throw new Error('conflicting_subscription_terms');
  }
  const facts: SubscriptionFact[] = [];
  const add = (claim: string, sources: Array<Fact | undefined>) => facts.push({
    claim, evidence: sources.filter((source): source is Fact => Boolean(source)).map(({ value: _value, ...source }) => ({ ...source, claim })),
  });
  const shares = (fact: Fact, digits = 8) => `${format(fact.value / 1e8, digits)}亿份`;
  const structure = [
    total && `本次发售基金份额总额为${shares(total)}`,
    strategic && `战略配售初始份额为${shares(strategic)}`,
    offline && `网下发售初始份额为${shares(offline)}`,
    publicOffer && `公众发售初始份额为${shares(publicOffer)}`,
  ].filter(Boolean).join('，');
  if (structure) add(structure, [total, strategic, offline, publicOffer]);
  if (strategicRatio) add(`战略投资者有效认购申请确认比例为${strategicRatio.value}%`, [strategicRatio]);
  if (offlineEffective || offlineRatio) add([
    offlineEffective && `网下投资者有效认购份额总数约${shares(offlineEffective, 3)}`,
    offlineRatio && `对应配售比例为${offlineRatio.value}%`,
  ].filter(Boolean).join('，'), [offlineEffective, offlineRatio]);
  if (publicEffective || publicRatio || multiple) add([
    publicEffective && `公众投资者有效认购份额约${shares(publicEffective, 3)}`,
    publicRatio && `有效认购申请确认比例为${publicRatio.value}%`,
    multiple ? `认购倍数约${multiple.value}倍` : publicEffective && publicOffer && `按有效认购份额与公众初始发售份额计算，认购倍数约${format(publicEffective.value / publicOffer.value, 2)}倍`,
  ].filter(Boolean).join('，'), [publicEffective, publicRatio, multiple || publicEffective && publicOffer]);
  if (price) add(`此前确定的基金份额认购价格为${price.value}元/份`, [price]);
  const finalScale = find(results, '最终募集规模(?:为|将为)?', false, '元');
  if (finalScale) add(`最终募集规模为${format(finalScale.value / 1e8, 6)}亿元`, [finalScale]);
  else if (price && total) add(`按认购价格和发售总份额计算，预计募集规模为${format(price.value * total.value / 1e8, 6)}亿元，不含认购费用及募集期利息`, [price, total]);
  return facts;
}
