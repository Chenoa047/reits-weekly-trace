export type OfferingType = '首发' | '扩募';

export type ReitsDocumentKind =
  | '招募说明书'
  | '反馈意见'
  | '问询函'
  | '回复反馈'
  | '询价'
  | '发售'
  | '认购结果'
  | '上市'
  | '其他';

export type ReitsSourceFile = {
  label: string;
  url: string;
  kind: ReitsDocumentKind;
  originalTitle: string;
  publishedAt?: string;
  section?: string;
  issuerRole?: '交易所' | '原始权益人' | '披露主体';
  content?: string;
};

export type ReitsStage =
  | '申报'
  | '受理'
  | '反馈/问询'
  | '回复反馈'
  | '注册生效'
  | '询价'
  | '发售'
  | '认购结果'
  | '上市';

export function classifyDocument(title: string): ReitsDocumentKind {
  if (/上市交易(?:提示性|性提示)|上市提示性公告/.test(title)) return '上市';
  if (/认购申请确认比例(?:结果)?|认购结果/.test(title)) return '认购结果';
  if (/基金份额发售公告/.test(title)) return '发售';
  if (/基金份额询价公告/.test(title)) return '询价';
  if (/招募说明书/.test(title)) return '招募说明书';
  if (
    /(?:反馈意见|问询函).*(?:答复|回复)|(?:答复|回复).*(?:反馈意见|问询函)/.test(
      title,
    )
  )
    return '回复反馈';
  if (/反馈意见/.test(title)) return '反馈意见';
  if (/问询函/.test(title)) return '问询函';
  return '其他';
}

export function documentLabel(kind: ReitsDocumentKind) {
  const labels: Record<ReitsDocumentKind, string> = {
    招募说明书: '最新招募说明书原文',
    反馈意见: '受理反馈意见原文',
    问询函: '审核问询函原文',
    回复反馈: '反馈/问询回复原文',
    询价: '基金份额询价公告原文',
    发售: '基金份额发售公告原文',
    认购结果: '认购申请确认比例结果公告原文',
    上市: '上市交易提示性公告原文',
    其他: '项目披露原文',
  };
  return labels[kind];
}

export function inferProjectStage(
  status: string,
  files: ReitsSourceFile[],
): string {
  if (status === '已反馈' || status === '已问询') {
    const sectionFiles = files.filter(
      (file) =>
        file.section === '反馈意见及回复' || file.section === '问询与回复',
    );
    const hasExchangeQuestion = sectionFiles.some(
      (file) => file.kind === '反馈意见' || file.kind === '问询函',
    );
    const hasOriginatorReply = sectionFiles.some(
      (file) => file.kind === '回复反馈',
    );
    return hasExchangeQuestion && hasOriginatorReply ? '回复反馈' : '反馈/问询';
  }
  if (status === '已回复交易所意见') return '回复反馈';
  if (status === '已受理') return '受理';
  if (status === '已申报') return '申报';
  if (status === '注册生效') return '注册生效';
  return status;
}

export function selectStageFiles(stage: string, files: ReitsSourceFile[]) {
  const latest = (kind: ReitsDocumentKind) =>
    files
      .filter((file) => file.kind === kind)
      .sort((a, b) =>
        (b.publishedAt || '').localeCompare(a.publishedAt || ''),
      )[0];
  const present = (items: Array<ReitsSourceFile | undefined>) =>
    items.filter((file): file is ReitsSourceFile => Boolean(file));

  if (stage === '申报') return [];
  if (stage === '受理' || stage === '注册生效')
    return present([latest('招募说明书')]);
  if (stage === '反馈/问询') {
    return files.filter(
      (file) =>
        (file.section === '反馈意见及回复' || file.section === '问询与回复') &&
        (file.kind === '反馈意见' || file.kind === '问询函'),
    );
  }
  if (stage === '回复反馈') {
    return files.filter(
      (file) =>
        (file.section === '反馈意见及回复' || file.section === '问询与回复') &&
        (file.kind === '反馈意见' ||
          file.kind === '问询函' ||
          file.kind === '回复反馈'),
    );
  }
  if (stage === '询价') return present([latest('询价'), latest('招募说明书')]);
  if (stage === '发售') return present([latest('发售'), latest('招募说明书')]);
  if (stage === '认购结果')
    return present([latest('认购结果'), latest('招募说明书')]);
  if (stage === '上市') {
    return present([
      latest('上市'),
      latest('招募说明书'),
      latest('发售'),
      latest('认购结果'),
    ]);
  }
  return [];
}

export function missingRequiredMaterial(
  stage: string,
  files: ReitsSourceFile[],
) {
  if (stage === '申报') return [];
  const required: Partial<Record<ReitsStage, ReitsDocumentKind[]>> = {
    受理: ['招募说明书'],
    '反馈/问询': ['反馈意见'],
    回复反馈: ['回复反馈'],
    注册生效: ['招募说明书'],
    询价: ['询价'],
    发售: ['发售'],
    认购结果: ['认购结果'],
    上市: ['上市'],
  };
  const kinds = new Set(files.map((file) => file.kind));
  const expected = required[stage as ReitsStage] || [];
  if (stage === '反馈/问询' && kinds.has('问询函')) return [];
  return expected.filter((kind) => !kinds.has(kind));
}

export function announcementStage(
  title: string,
): Extract<ReitsStage, '询价' | '发售' | '认购结果' | '上市'> | null {
  const kind = classifyDocument(title);
  return kind === '询价' ||
    kind === '发售' ||
    kind === '认购结果' ||
    kind === '上市'
    ? kind
    : null;
}
