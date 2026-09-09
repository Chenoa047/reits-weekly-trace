CREATE TABLE `fetch_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`sse_count` integer DEFAULT 0 NOT NULL,
	`szse_count` integer DEFAULT 0 NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`exchange` text NOT NULL,
	`full_name` text NOT NULL,
	`short_name` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`progress_type` text NOT NULL,
	`update_date` text NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`originator` text,
	`brief` text NOT NULL,
	`note` text,
	`files_json` text NOT NULL,
	`source_html` text NOT NULL,
	`source_url` text,
	`raw_json` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`archived_at` text NOT NULL,
	`snapshot_json` text NOT NULL
);
