CREATE TABLE `account_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL
);
