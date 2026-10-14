export function szseAnnouncementHistoryBody(
  weekStart: string,
  weekEnd: string,
  pageNum: number,
) {
  return {
    seDate: [weekStart, weekEnd],
    channelCode: ['reits-xxpl'],
    pageSize: 50,
    pageNum,
  };
}

export function firstSzseAnnouncementValue(value: string | string[]) {
  return Array.isArray(value) ? value[0] || '' : value;
}

export function szseSupportingHistoryStart(weekStart: string) {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 120);
  return date.toISOString().slice(0, 10);
}

export function sameSzseFund(left: string | string[], right: string | string[]) {
  const leftCodes = (Array.isArray(left) ? left : [left]).filter(Boolean);
  const rightCodes = (Array.isArray(right) ? right : [right]).filter(Boolean);
  return leftCodes.some(code => rightCodes.includes(code));
}
