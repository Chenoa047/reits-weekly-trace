import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  exchange: text('exchange').notNull(),
  fullName: text('full_name').notNull(),
  shortName: text('short_name').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  progressType: text('progress_type').notNull(),
  updateDate: text('update_date').notNull(),
  weekStart: text('week_start').notNull(),
  weekEnd: text('week_end').notNull(),
  originator: text('originator'),
  brief: text('brief').notNull(),
  note: text('note'),
  filesJson: text('files_json').notNull(),
  sourceHtml: text('source_html').notNull(),
  sourceUrl: text('source_url'),
  rawJson: text('raw_json').notNull(),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const fetchRuns = sqliteTable('fetch_runs', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  weekStart: text('week_start').notNull(),
  weekEnd: text('week_end').notNull(),
  sseCount: integer('sse_count').notNull().default(0),
  szseCount: integer('szse_count').notNull().default(0),
  message: text('message'),
});

export const weeklyArchives = sqliteTable('weekly_archives', {
  id: text('id').primaryKey(),
  weekStart: text('week_start').notNull(),
  weekEnd: text('week_end').notNull(),
  archivedAt: text('archived_at').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
});
