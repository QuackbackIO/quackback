-- @contract: additive
-- Links that show a portal design not yet live to someone without admin
-- access. Each holds the design as it was when the link was made, and only
-- the SHA-256 hash of its token; the token itself is shown once.
CREATE TABLE IF NOT EXISTS "portal_design_preview_links" (
  "id" uuid PRIMARY KEY NOT NULL,
  "design_id" uuid NOT NULL
    CONSTRAINT "portal_design_preview_links_design_id_portal_designs_id_fk"
    REFERENCES "portal_designs"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "document" jsonb NOT NULL,
  "created_by_principal_id" uuid
    CONSTRAINT "portal_design_preview_links_created_by_fk"
    REFERENCES "principal"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_design_preview_links_token_hash_idx"
  ON "portal_design_preview_links" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_design_preview_links_design_idx"
  ON "portal_design_preview_links" ("design_id", "expires_at");
