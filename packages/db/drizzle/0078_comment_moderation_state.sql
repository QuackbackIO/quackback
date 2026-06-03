ALTER TABLE "comments" ADD COLUMN "moderation_state" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
CREATE INDEX "comments_moderation_state_idx" ON "comments" USING btree ("moderation_state");
