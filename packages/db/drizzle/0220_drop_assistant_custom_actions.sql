-- Remove the assistant custom-actions feature (dynamic HTTP actions for the
-- Quinn assistant, gated behind the experimental `assistantCustomActions`
-- feature flag, never left experimental).
--
-- Drops the `assistant_actions` definition table, sweeps stale pending
-- proposals for custom-action tool calls (`action_*` tool names), and strips
-- the obsolete `assistantCustomActions` key from settings.feature_flags.

-- Custom action definitions.
DROP TABLE IF EXISTS "assistant_actions";

-- Stale pending actions whose tool was a custom action can no longer be
-- resolved or executed.
DELETE FROM "assistant_pending_actions"
WHERE "tool_name" LIKE 'action\_%' ESCAPE '\';

-- Obsolete feature-flag key (feature_flags is JSON stored as text).
UPDATE "settings"
SET "feature_flags" = ("feature_flags"::jsonb - 'assistantCustomActions')::text
WHERE "feature_flags" IS NOT NULL
  AND "feature_flags"::jsonb ? 'assistantCustomActions';
