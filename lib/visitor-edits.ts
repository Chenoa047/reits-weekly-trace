type WeekRange = { start: string; end: string };

type WeekRecord = {
  weekStart: string;
  weekEnd: string;
};

type LocalRecordSnapshot<T> = {
  weekStart: string;
  weekEnd: string;
  records: T[];
};

export function readCurrentWeekLocalRecords<T extends WeekRecord>(
  raw: string | null,
  range: WeekRange,
): T[] | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as unknown;
    if (isSnapshot<T>(saved)) {
      return saved.weekStart === range.start && saved.weekEnd === range.end
        ? saved.records
        : null;
    }
    if (!Array.isArray(saved) || saved.length === 0) return null;
    return saved.every(
      (record) =>
        isWeekRecord(record) &&
        record.weekStart === range.start &&
        record.weekEnd === range.end,
    )
      ? (saved as T[])
      : null;
  } catch {
    return null;
  }
}

export function serializeLocalRecords<T>(records: T[], range: WeekRange) {
  return JSON.stringify({
    weekStart: range.start,
    weekEnd: range.end,
    records,
  } satisfies LocalRecordSnapshot<T>);
}

function isSnapshot<T>(value: unknown): value is LocalRecordSnapshot<T> {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<LocalRecordSnapshot<T>>;
  return (
    typeof snapshot.weekStart === 'string' &&
    typeof snapshot.weekEnd === 'string' &&
    Array.isArray(snapshot.records)
  );
}

function isWeekRecord(value: unknown): value is WeekRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<WeekRecord>;
  return (
    typeof record.weekStart === 'string' && typeof record.weekEnd === 'string'
  );
}
