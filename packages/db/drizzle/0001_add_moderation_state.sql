-- Add moderation_state column to posts
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "moderation_state" text DEFAULT 'published' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_moderation_state_idx" ON "posts" USING btree ("moderation_state");
