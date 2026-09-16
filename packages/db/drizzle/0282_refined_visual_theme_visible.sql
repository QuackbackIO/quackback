-- Make Labs "Refreshed UI" discoverable on every existing workspace.
-- Runtime theme stays off unless the workspace already enabled it.
-- Missing rows become { visible: true, enabled: false }. Existing rows
-- only flip visible; enabled is left alone. The ON CONFLICT WHERE means
-- a second run writes nothing once every settings row already has a
-- visible refined-visual-theme row.
--
-- @contract: additive
INSERT INTO "workspace_experiments" (
  "settings_id",
  "experiment_id",
  "visible",
  "enabled"
)
SELECT
  "id",
  'refined-visual-theme',
  true,
  false
FROM "settings"
ON CONFLICT ("settings_id", "experiment_id") DO UPDATE
SET
  "visible" = true,
  "updated_at" = now()
WHERE "workspace_experiments"."visible" IS DISTINCT FROM true;
