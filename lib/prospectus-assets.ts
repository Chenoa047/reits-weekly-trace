type SourceFile = { kind: string; url: string; content?: string; publishedAt?: string; originalTitle?: string };
type Evidence = { fileUrl: string; page: number; quote: string; claim: string };

// Only use explicitly labelled rows in a project overview table; do not infer a project from a fund name.
export function prospectusAssetFacts(files: SourceFile[], offeringType?: string) {
  const file = files.filter(file => file.kind === '招募说明书' && file.content)
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))[0];
  if (!file) return [];
  const pages = (file.content || '').split(/(?=\[第\d+页\])/).map(part => ({
    page: Number(part.match(/^\[第(\d+)页\]/)?.[1]), text: part.normalize('NFKC').replace(/\s/g, ''),
  })).filter(part => part.page);
  const expansion = offeringType === '扩募' || /扩募|新购入/.test(file.originalTitle || '');
  const scope = expansion ? pages.map(page => page.text).join('\n')
    .match(/本基金本次扩募(?:发售)?概况[^\n]{0,300}?不动产项目名称(.{2,220}?)(?:募集规模|上市的证券交易所|基金管理人)/)?.[1] : undefined;
  for (const [index, part] of pages.entries()) {
    const name = part.text.match(/不动产项目名称(.{2,220}?)(?:大类资产类型|不动产项目业态)/);
    const next = pages[index + 1];
    const nearby = [part, ...(next?.page === part.page + 1 ? [next] : [])];
    const located = nearby.find(page => /(?:项目|资产)所在地(.{2,80}?)资产范围/.test(page.text));
    const location = located?.text.match(/((?:项目|资产)所在地)(.{2,80}?)资产范围/);
    if (!name || !location) continue;
    const columns = new Set(part.text.slice(Math.max(0, name.index! - 100), name.index).match(/项目(?:[一二三四五六七八九十]|\d+)/g) || []).size;
    const projects = columns || new Set(name[1].match(/项目公司[一二三四五六七八九十\d]+/g) || []).size || 1;
    const label = name[1].replace(/项目公司[一二三四五六七八九十\d]+(?:持有并运营的)?/g, '、').replace(/[(（]简称[^)）]*[)）]/g, '').replace(/^、/, '');
    const names = label.includes('、') ? label.split('、') : projects === 1 ? [label] : label.match(/.+?项目/g) || [];
    if (names.length !== projects || names.join('') !== label.replaceAll('、', '')) continue;
    if (expansion && (scope ? /[^、，,及和与]/.test(names.reduce((remaining, name) => remaining.replace(name, ''), scope)) : !/本次扩募|拟购入|新购入/.test(part.text.slice(0, name.index)))) continue;
    const commonLocation = location[2].slice(0, location[2].length / projects);
    const sharedLocation = commonLocation.repeat(projects) === location[2];
    const place = sharedLocation ? commonLocation : location[2].replace(/(?<=.)广东省/g, '、广东省');
    const claim = `招募说明书${file.originalTitle?.includes('草案') ? '草案' : ''}显示，${expansion ? '本次扩募拟购入的' : ''}底层资产为${names.join('、')}，${projects > 1 ? sharedLocation ? '均' : '分别' : ''}位于${place}`;
    const evidence = (quote: string, page = part.page, sentence = claim): Evidence => ({ fileUrl: file.url, page, quote, claim: sentence });
    const facts = [{ claim, evidence: [evidence(name[0].replace(/(?:大类资产类型|不动产项目业态)$/, '')), evidence(`${location[1]}${location[2]}`, located!.page)] }];
    const table = nearby.map(page => page.text).join('\n').slice(name.index).split(/开竣工|使用期限|可供分配金额测算/)[0];
    // Use one table row, so repeated disclosure in the next row is not another project's scale.
    const constructionRow = table.match(/建设内容(?:和|及)规模([\s\S]+?)(?=建筑面积和可供|建筑面积及可供|$)/)?.[1];
    const scaleText = constructionRow || table;
    const scales = [...scaleText.matchAll(/(土地使用权面积|占地面积|总建筑面积|建筑总面积|(?<!登记|产权|人防)建筑面积|(?:发电)?总?装机容量)(?:为|:|：|约)?([\d,]+(?:\.\d+)?)(平方米|万平方米|MW|兆瓦|万千瓦|千瓦)/g)]
      .map(match => ({ page: nearby.find(page => page.text.includes(match[0]))!.page, quote: match[0], metric: match[1].includes('装机') ? '装机容量' : match[1], value: Number(match[2].replace(/,/g, '')), unit: match[3] }));
    // A construction row may disclose capacity as unit count × capacity rather than a labelled total.
    const construction = nearby.map(page => ({ page: page.page, text: page.text.match(/建设内容(?:和|及)规模(.+?)(?:决算总投资|建筑面积|开竣工|$)/)?.[1] || '' }))
      .find(row => row.text);
    const units = projects === 1 && !scales.some(scale => scale.metric === '装机容量') && construction
      ? [...construction.text.matchAll(/(\d+)(?:×|台)([\d,]+(?:\.\d+)?)(MW|兆瓦|万千瓦|千瓦)(?:的)?[^，。；\d]{0,12}机组/g)]
        .map(match => ({ page: construction.page, quote: match[0], metric: '装机容量', value: Number(match[1]) * Number(match[2].replace(/,/g, '')), unit: match[3] })) : [];
    const metric = units.length ? '装机容量' : ['装机容量', '土地使用权面积', '占地面积', '总建筑面积', '建筑总面积', '建筑面积'].find(metric => scales.some(scale => scale.metric === metric));
    const matching = scales.filter(scale => scale.metric === metric);
    const selected = units.length ? units : projects > 1 ? matching.length === projects ? matching : [] : matching.slice(0, 1);
    if (selected.length >= projects) {
      const area = selected[0].unit.includes('平方米');
      const values = selected.map(scale => scale.value * (scale.unit === '平方米' || scale.unit === '千瓦' ? 0.0001 : scale.unit === 'MW' || scale.unit === '兆瓦' ? 0.1 : 1));
      const total = values.reduce((sum, value) => sum + value, 0).toFixed(2).replace(/\.?0+$/, '');
      const scaleClaim = `上述项目${metric}${projects > 1 ? '合计' : ''}约${total}万${area ? '平方米' : '千瓦'}`;
      facts.push({ claim: scaleClaim, evidence: selected.map(scale => evidence(scale.quote, scale.page, scaleClaim)) });
    }
    return facts;
  }
  return [];
}
