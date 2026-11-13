CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`provider_reference` text,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_purchase_unique` ON `payments` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `refund_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`requested_by_user_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text NOT NULL,
	`refund_amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` integer,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_requests_purchase_unique` ON `refund_requests` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refund_request_id` integer NOT NULL,
	`payment_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`provider_reference` text,
	`failure_reason` text,
	`issued_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`refund_request_id`) REFERENCES `refund_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refunds_request_idx` ON `refunds` (`refund_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_one_success_per_payment` ON `refunds` (`payment_id`) WHERE "refunds"."status" = 'succeeded';--> statement-breakpoint
-- Every existing purchase was paid in full, in USD, when it was made.
INSERT INTO `payments` (`purchase_id`, `amount`, `currency`, `captured_at`) SELECT `id`, `amount_paid`, 'USD', `created_at` FROM `purchases`;