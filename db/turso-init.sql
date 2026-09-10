CREATE TABLE IF NOT EXISTS fetch_runs (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  sse_count INTEGER DEFAULT 0 NOT NULL,
  szse_count INTEGER DEFAULT 0 NOT NULL,
  message TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  exchange TEXT NOT NULL,
  full_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_type TEXT NOT NULL,
  update_date TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  originator TEXT,
  brief TEXT NOT NULL,
  note TEXT,
  files_json TEXT NOT NULL,
  source_html TEXT NOT NULL,
  source_url TEXT,
  raw_json TEXT NOT NULL,
  is_archived INTEGER DEFAULT 0 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_archives (
  id TEXT PRIMARY KEY NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);
