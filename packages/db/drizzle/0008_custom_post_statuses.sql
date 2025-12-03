-- Migration: Custom Post Statuses
-- Adds customizable post statuses per organization

-- Step 1: Create post_statuses table
CREATE TABLE "post_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"category" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"show_on_roadmap" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_statuses_category_check" CHECK ("category" IN ('active', 'complete', 'closed'))
);
--> statement-breakpoint

-- Step 2: Create indexes
CREATE UNIQUE INDEX "post_statuses_org_slug_idx" ON "post_statuses" USING btree ("organization_id", "slug");
--> statement-breakpoint
CREATE INDEX "post_statuses_org_id_idx" ON "post_statuses" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "post_statuses_position_idx" ON "post_statuses" USING btree ("organization_id", "category", "position");
--> statement-breakpoint

-- Step 3: Enable RLS on post_statuses
ALTER TABLE "post_statuses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Step 4: Create RLS policy for post_statuses
CREATE POLICY "post_statuses_tenant_isolation" ON "post_statuses"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint

-- Step 5: Seed default statuses for all existing organizations
-- Get distinct organizations from boards table and create default statuses
INSERT INTO "post_statuses" ("organization_id", "name", "slug", "color", "category", "position", "show_on_roadmap", "is_default")
SELECT DISTINCT
  b."organization_id",
  s."name",
  s."slug",
  s."color",
  s."category",
  s."position",
  s."show_on_roadmap",
  s."is_default"
FROM "boards" b
CROSS JOIN (VALUES
  ('Open', 'open', '#3b82f6', 'active', 0, false, true),
  ('Under Review', 'under_review', '#eab308', 'active', 1, false, false),
  ('Planned', 'planned', '#a855f7', 'active', 2, true, false),
  ('In Progress', 'in_progress', '#f97316', 'active', 3, true, false),
  ('Complete', 'complete', '#22c55e', 'complete', 0, true, false),
  ('Closed', 'closed', '#6b7280', 'closed', 0, false, false)
) AS s("name", "slug", "color", "category", "position", "show_on_roadmap", "is_default");
--> statement-breakpoint

-- Step 6: Add status_id column to posts (nullable initially)
ALTER TABLE "posts" ADD COLUMN "status_id" uuid;
--> statement-breakpoint

-- Step 7: Create index on status_id
CREATE INDEX "posts_status_id_idx" ON "posts" USING btree ("status_id");
--> statement-breakpoint

-- Step 8: Populate status_id based on existing status values
UPDATE "posts" p
SET "status_id" = ps."id"
FROM "post_statuses" ps
JOIN "boards" b ON b."organization_id" = ps."organization_id"
WHERE p."board_id" = b."id"
  AND p."status" = ps."slug";
--> statement-breakpoint

-- Step 9: Add foreign key constraint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_id_post_statuses_id_fk"
  FOREIGN KEY ("status_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- Note: We keep the old 'status' column for backwards compatibility during the transition
-- It can be removed in a future migration once all code uses status_id
