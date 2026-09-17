-- New workspaces created after 0282 have no experiment row (missing = both
-- false). Seed Refreshed UI on for those rows only. Existing 0282 rows keep
-- their enabled value: ON CONFLICT DO NOTHING does not flip a workspace that
-- already opted out or was left off.
--
-- Drop the 1h settings cache only when we actually insert, so a workspace
-- that already cached visualTheme=legacy does not stay on the old theme
-- until TTL. A replay inserts nothing, so the DELETE is a no-op.
--
-- @contract: additive
WITH inserted AS (
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
    true
  FROM "settings"
  ON CONFLICT ("settings_id", "experiment_id") DO NOTHING
  RETURNING "settings_id"
)
DELETE FROM "kv_store"
WHERE "key" IN ('settings:workspace', 'auth:registered-providers')
  AND EXISTS (SELECT 1 FROM inserted);
