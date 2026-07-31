-- Saved feedback-inbox views: workspace-shared filter sets over the post
-- inbox (mirrors the conversation_views pattern, minus pins).
--
-- A post_view is a serialized filter set (status / board / tags / owner /
-- responded / thresholds / sort — the saveable subset of the inbox filter
-- state; the search term never saves). Shared per the pattern (is_shared
-- default true), soft-deleted so a removed view keeps history. created_by is a
-- team actor (see REPOINT_EXEMPTIONS) and set null on offboarding so a shared
-- view outlives its creator.
CREATE TABLE "post_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_by_principal_id" uuid,
	"is_shared" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "post_views"
	ADD CONSTRAINT "post_views_created_by_principal_id_fkey"
	FOREIGN KEY ("created_by_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- Toolbar listing: shared, non-deleted views.
CREATE INDEX "post_views_shared_idx" ON "post_views" ("is_shared") WHERE "deleted_at" IS NULL;
