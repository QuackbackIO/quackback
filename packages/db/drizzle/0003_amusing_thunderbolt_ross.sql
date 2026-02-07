-- Migrate workspace info from dedicated columns into config JSONB before dropping
UPDATE "integrations"
SET "config" = jsonb_set(
  jsonb_set(
    COALESCE("config", '{}'::jsonb),
    '{workspaceId}',
    to_jsonb(COALESCE("external_workspace_id", ''))
  ),
  '{workspaceName}',
  to_jsonb(COALESCE("external_workspace_name", ''))
)
WHERE "external_workspace_id" IS NOT NULL
   OR "external_workspace_name" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" DROP COLUMN "external_workspace_id";--> statement-breakpoint
ALTER TABLE "integrations" DROP COLUMN "external_workspace_name";
