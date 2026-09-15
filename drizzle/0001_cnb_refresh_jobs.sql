ALTER TABLE `fetch_runs` ADD `trigger` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `fetch_runs` ADD `cnb_build_id` text;
--> statement-breakpoint
CREATE TABLE `refresh_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL
);
