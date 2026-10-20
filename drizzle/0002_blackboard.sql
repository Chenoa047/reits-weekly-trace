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
