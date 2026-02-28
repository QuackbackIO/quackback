ALTER TABLE "dismissed_merge_pairs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_themes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idea_post_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "dismissed_merge_pairs" CASCADE;--> statement-breakpoint
DROP TABLE "feedback_themes" CASCADE;--> statement-breakpoint
DROP TABLE "idea_post_links" CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "feedback_signals_theme_idx";--> statement-breakpoint
ALTER TABLE "feedback_signals" DROP COLUMN "theme_id";