-- @contract: additive
-- Designs a workspace keeps without publishing them: named checkpoints of
-- the draft, and looks (colours, fonts, shape and layout) to apply again.
CREATE TABLE IF NOT EXISTS "portal_design_saved" (
  "id" uuid PRIMARY KEY NOT NULL,
  "design_id" uuid NOT NULL
    CONSTRAINT "portal_design_saved_design_id_portal_designs_id_fk"
    REFERENCES "portal_designs"("id") ON DELETE CASCADE,
  "kind" text NOT NULL
    CONSTRAINT "portal_design_saved_kind_check" CHECK ("kind" IN ('checkpoint', 'look')),
  "name" text NOT NULL,
  "document" jsonb NOT NULL,
  "created_by_principal_id" uuid
    CONSTRAINT "portal_design_saved_created_by_principal_id_principal_id_fk"
    REFERENCES "principal"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_design_saved_design_kind_idx"
  ON "portal_design_saved" ("design_id", "kind", "created_at");
