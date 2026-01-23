-- Migration: Add granular notification controls to post_subscriptions
--
-- This replaces the boolean `muted` column with two separate columns:
-- - notify_comments: receive notifications for new comments
-- - notify_status_changes: receive notifications for status changes
--
-- "All activity" = both true
-- "Status changes only" = notify_comments=false, notify_status_changes=true
-- "Unsubscribed" = row deleted

-- Step 1: Add new columns with defaults
ALTER TABLE "post_subscriptions"
ADD COLUMN "notify_comments" boolean DEFAULT true NOT NULL,
ADD COLUMN "notify_status_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Step 2: Migrate data from muted column
-- If muted=true, set both to false (was silencing all notifications)
-- If muted=false, keep both as true (default - all notifications)
UPDATE "post_subscriptions"
SET "notify_comments" = NOT "muted",
    "notify_status_changes" = NOT "muted";--> statement-breakpoint

-- Step 3: Drop old index and column
DROP INDEX IF EXISTS "post_subscriptions_post_active_idx";--> statement-breakpoint
ALTER TABLE "post_subscriptions" DROP COLUMN "muted";--> statement-breakpoint

-- Step 4: Create new partial indexes for efficient subscriber lookups
CREATE INDEX "post_subscriptions_post_comments_idx"
ON "post_subscriptions" ("post_id")
WHERE notify_comments = true;--> statement-breakpoint

CREATE INDEX "post_subscriptions_post_status_idx"
ON "post_subscriptions" ("post_id")
WHERE notify_status_changes = true;
