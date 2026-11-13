DROP TABLE `refunds`;--> statement-breakpoint
ALTER TABLE `purchases` ADD `status` text DEFAULT 'active' NOT NULL;