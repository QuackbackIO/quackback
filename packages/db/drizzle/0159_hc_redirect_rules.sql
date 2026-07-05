-- Help center redirect rules (domains/languages §2): admin-defined path -> target
-- 301s for the /hc site. target_type/target_id is a polymorphic reference (article
-- or category) with no FK constraint -- the owning article/category service deletes
-- orphaned rules explicitly on hard delete, since a single FK can't span two tables.
-- Many rules may point at the same target; `path` itself is the unique key.
CREATE TABLE "hc_redirect_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hc_redirect_rules_path_idx" ON "hc_redirect_rules" USING btree ("path");
--> statement-breakpoint
CREATE INDEX "hc_redirect_rules_target_idx" ON "hc_redirect_rules" USING btree ("target_type","target_id");
