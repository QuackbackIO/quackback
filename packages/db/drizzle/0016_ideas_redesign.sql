CREATE TABLE "dismissed_merge_pairs" (
	"theme_a_id" uuid NOT NULL,
	"theme_b_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_by_principal_id" uuid
);
--> statement-breakpoint
CREATE TABLE "idea_post_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"theme_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"link_type" varchar(20) DEFAULT 'auto' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by_principal_id" uuid
);
--> statement-breakpoint
ALTER TABLE "feedback_themes" ALTER COLUMN "status" SET DEFAULT 'under_review';--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD COLUMN "planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD COLUMN "in_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD COLUMN "signals_this_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD COLUMN "signals_last_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dismissed_merge_pairs" ADD CONSTRAINT "dismissed_merge_pairs_theme_a_id_feedback_themes_id_fk" FOREIGN KEY ("theme_a_id") REFERENCES "public"."feedback_themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_merge_pairs" ADD CONSTRAINT "dismissed_merge_pairs_theme_b_id_feedback_themes_id_fk" FOREIGN KEY ("theme_b_id") REFERENCES "public"."feedback_themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_merge_pairs" ADD CONSTRAINT "dismissed_merge_pairs_dismissed_by_principal_id_principal_id_fk" FOREIGN KEY ("dismissed_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_post_links" ADD CONSTRAINT "idea_post_links_theme_id_feedback_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."feedback_themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_post_links" ADD CONSTRAINT "idea_post_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_post_links" ADD CONSTRAINT "idea_post_links_linked_by_principal_id_principal_id_fk" FOREIGN KEY ("linked_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dismissed_merge_pairs_unique_idx" ON "dismissed_merge_pairs" USING btree ("theme_a_id","theme_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_post_links_unique_idx" ON "idea_post_links" USING btree ("theme_id","post_id");--> statement-breakpoint
CREATE INDEX "idea_post_links_theme_idx" ON "idea_post_links" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "idea_post_links_post_idx" ON "idea_post_links" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "feedback_themes_status_idx" ON "feedback_themes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_themes_active_title_idx" ON "feedback_themes" USING btree (LOWER(TRIM("title"))) WHERE "feedback_themes"."status" IN ('under_review', 'planned', 'in_progress');--> statement-breakpoint
ALTER TABLE "feedback_themes" DROP COLUMN "promoted_to_post_id";--> statement-breakpoint
-- Data migration: convert existing 'active' status to 'under_review'
UPDATE "feedback_themes" SET "status" = 'under_review' WHERE "status" = 'active';