-- Stamp workspaces that never persisted product flags so they keep today's
-- all-on surface after DEFAULT_FEATURE_FLAGS becomes core-only (Feedback +
-- Changelog). Stored keys win; missing keys receive the previous defaults.
-- New workspaces write an explicit JSON blob on insert and pick up the new
-- defaults instead.
UPDATE "settings"
SET "feature_flags" = (
  '{"feedback":true,"changelog":true,"helpCenter":true,"supportInbox":true,"supportTickets":true,"statusPage":true,"inboxAi":true,"assistantConnectors":false,"assistantSkills":false}'::jsonb
  || coalesce("feature_flags"::jsonb, '{}'::jsonb)
)::text
WHERE "feature_flags" IS NULL
   OR btrim("feature_flags") IN ('', 'null');
