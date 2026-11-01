-- @contract: additive
-- Portal designs: each site's design document as a draft and as numbered,
-- immutable published revisions. A NULL site_id is the workspace's default
-- site. published_revision_id and draft_base_revision_id point into
-- portal_design_revisions without a foreign key, because the two tables
-- reference each other; the service keeps them consistent.
CREATE TABLE IF NOT EXISTS "portal_designs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "site_id" uuid,
  "published_revision_id" uuid,
  "draft" jsonb,
  "draft_base_revision_id" uuid,
  "draft_updated_at" timestamp with time zone,
  "draft_updated_by_principal_id" uuid
    CONSTRAINT "portal_designs_draft_updated_by_principal_id_principal_id_fk"
    REFERENCES "principal"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_designs_site_idx"
  ON "portal_designs" ((COALESCE("site_id", '00000000-0000-0000-0000-000000000000'::uuid)));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_design_revisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "design_id" uuid NOT NULL
    CONSTRAINT "portal_design_revisions_design_id_portal_designs_id_fk"
    REFERENCES "portal_designs"("id") ON DELETE CASCADE,
  "number" integer NOT NULL,
  "document" jsonb NOT NULL,
  "source" text NOT NULL,
  "principal_id" uuid
    CONSTRAINT "portal_design_revisions_principal_id_principal_id_fk"
    REFERENCES "principal"("id") ON DELETE SET NULL,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_design_revisions_design_number_idx"
  ON "portal_design_revisions" ("design_id", "number");
