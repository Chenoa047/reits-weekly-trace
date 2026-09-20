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
