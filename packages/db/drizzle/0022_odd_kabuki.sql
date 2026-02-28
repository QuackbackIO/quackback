ALTER TABLE "posts" ADD COLUMN "summary_json" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "summary_model" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "summary_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "summary_comment_count" integer;