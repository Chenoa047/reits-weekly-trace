import { briefRulesVersionFor, canonicalBrief, isBriefDisplayable } from './deepseek.ts';
import type { ReitsRecord } from './reits.ts';

export function briefAfterGenerationFailure(
  incoming: ReitsRecord,
  existing: ReitsRecord | null,
  reason: string,
) {
  if (
    existing &&
    existing.progressType === incoming.progressType &&
    isBriefDisplayable(existing.brief, existing.progressType) &&
    existing.brief !== canonicalBrief(existing) &&
    (existing.evidence?.length || 0) > 0
  ) {
    return {
      record: {
        ...existing,
        note: `本次更新未发布，原因：${reason}；保留此前已核验的完整简报。`,
      },
      preserved: true,
    };
  }

  return {
    record: {
      ...incoming,
      brief: canonicalBrief(incoming),
      evidence: [],
      briefRulesVersion: briefRulesVersionFor(incoming.progressType),
      note: `本条仅发布交易所确认的项目进度；扩展事实未发布，原因：${reason}。`,
    },
    preserved: false,
  };
}
