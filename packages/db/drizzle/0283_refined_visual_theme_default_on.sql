-- New workspaces created after 0282 have no experiment row (missing = both
-- false). Seed Refreshed UI on for those rows only. Existing 0282 rows keep
-- their enabled value: ON CONFLICT DO NOTHING does not flip a workspace that
-- already opted out or was left off.
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
  true
FROM "settings"
ON CONFLICT ("settings_id", "experiment_id") DO NOTHING;
