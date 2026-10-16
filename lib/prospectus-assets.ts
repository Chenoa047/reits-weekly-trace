type SourceFile = { kind: string; url: string; content?: string; publishedAt?: string; originalTitle?: string };
type Evidence = { fileUrl: string; page: number; quote: string; claim: string };

// Only use explicitly labelled rows in a project overview table; do not infer a project from a fund name.
export function prospectusAssetFacts(files: SourceFile[]) {
  const file = files.filter(file => file.kind === '招募说明书' && file.content)
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))[0];
  if (!file) return [];
  const pages = (file.content || '').split(/(?=\[第\d+页\])/).map(part => ({
    page: Number(part.match(/^\[第(\d+)页\]/)?.[1]), text: part.normalize('NFKC').replace(/\s/g, ''),
  })).filter(part => part.page);
  for (const part of pages) {
    const name = part.text.match(/不动产项目名称(.{2,220}?)(?:大类资产类型|不动产项目业态)/);
    const location = part.text.match(/项目所在地(.{2,80}?)资产范围/);
    if (!name || !location) continue;
    const projects = new Set(name[1].match(/项目公司[一二三123]/g) || []).size || 1;
    const label = name[1].replace(/项目公司[一二三123](?:持有并运营的)?/g, '、').replace(/[(（]简称[^)）]*[)）]/g, '').replace(/^、/, '');
    const claim = `招募说明书${file.originalTitle?.includes('草案') ? '草案' : ''}显示，底层资产为${label}，${projects > 1 ? '分别' : ''}位于${location[1].replace(/(?<=.)广东省/g, '、广东省')}`;
    const evidence = (quote: string, page = part.page, sentence = claim): Evidence => ({ fileUrl: file.url, page, quote, claim: sentence });
    const facts = [{ claim, evidence: [evidence(`不动产项目名称${name[1]}`), evidence(`项目所在地${location[1]}`)] }];
    const nearby = pages.filter(page => page.page >= part.page && page.page <= part.page + 1);
    const scales = nearby.flatMap(page => [...page.text.matchAll(/(土地使用权面积|占地面积|总建筑面积|建筑总面积|(?<!登记|产权|人防)建筑面积|(?:发电)?总?装机容量)(?:为|:|：|约)?([\d,]+(?:\.\d+)?)(平方米|万平方米|MW|兆瓦|万千瓦|千瓦)/g)]
      .map(match => ({ page: page.page, quote: match[0], metric: match[1].includes('装机') ? '装机容量' : match[1], value: Number(match[2].replace(/,/g, '')), unit: match[3] })));
    // A construction row may disclose capacity as unit count × capacity rather than a labelled total.
    const construction = nearby.map(page => ({ page: page.page, text: page.text.match(/建设内容(?:和|及)规模(.+?)(?:决算总投资|建筑面积|开竣工|$)/)?.[1] || '' }))
      .find(row => row.text);
    const units = projects === 1 && !scales.some(scale => scale.metric === '装机容量') && construction
      ? [...construction.text.matchAll(/(\d+)(?:×|台)([\d,]+(?:\.\d+)?)(MW|兆瓦|万千瓦|千瓦)(?:的)?[^，。；\d]{0,12}机组/g)]
        .map(match => ({ page: construction.page, quote: match[0], metric: '装机容量', value: Number(match[1]) * Number(match[2].replace(/,/g, '')), unit: match[3] })) : [];
    const metric = units.length ? '装机容量' : ['装机容量', '土地使用权面积', '占地面积', '总建筑面积', '建筑总面积', '建筑面积'].find(metric => scales.some(scale => scale.metric === metric));
    const selected = units.length ? units : scales.filter(scale => scale.metric === metric).slice(0, projects);
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
