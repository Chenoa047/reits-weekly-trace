CREATE TABLE IF NOT EXISTS fetch_runs (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  trigger TEXT DEFAULT 'legacy' NOT NULL,
  cnb_build_id TEXT,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  sse_count INTEGER DEFAULT 0 NOT NULL,
  szse_count INTEGER DEFAULT 0 NOT NULL,
  message TEXT
);

CREATE TABLE IF NOT EXISTS refresh_locks (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS blackboard_threads (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blackboard_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES blackboard_threads(id),
  author TEXT NOT NULL CHECK (author IN ('visitor', 'chen')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS blackboard_messages_thread_created
ON blackboard_messages(thread_id, created_at);
