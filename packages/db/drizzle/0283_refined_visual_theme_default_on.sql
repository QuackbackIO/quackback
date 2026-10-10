-- New workspaces created after 0282 have no experiment row (missing = both
-- false). Seed Refreshed UI on for those rows only. Existing 0282 rows keep
-- their enabled value: ON CONFLICT DO NOTHING does not flip a workspace that
-- already opted out or was left off.
--
-- Drop the 1h settings cache only when we actually insert, so a workspace
-- that already cached visualTheme=legacy does not stay on the old theme
-- until TTL. The writes sit in a DO block so a fleet replay is a no-op:
-- ON CONFLICT DO NOTHING inserts nothing, the CTE is empty, and the DELETE
-- does not run. A bare CTE DELETE at the tip would collapse the gap-heal
-- window.
--
-- @contract: additive

-- @replay: guarded-by every settings row already having a refined-visual-theme experiment; ON CONFLICT then inserts nothing and the cache DELETE does not run
DO $$
BEGIN
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
END $$;
