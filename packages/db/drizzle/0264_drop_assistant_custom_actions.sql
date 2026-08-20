-- @contract: safe-after 0.13.2   (Labs experiment retired for Connectors in
-- 0263; the flag key is stripped below so nothing resolves it any more)
-- Retire the custom-actions Labs experiment in favor of Agent Connectors.
-- Drops the definition table, sweeps stale action_* pending proposals, and
-- strips the obsolete assistantCustomActions flag key.
DROP TABLE IF EXISTS "assistant_actions";
--> statement-breakpoint
DELETE FROM "assistant_pending_actions"
WHERE "tool_name" LIKE 'action\_%' ESCAPE '\';
--> statement-breakpoint
UPDATE "settings"
SET "feature_flags" = ("feature_flags"::jsonb - 'assistantCustomActions')::text
WHERE "feature_flags" IS NOT NULL
  AND "feature_flags"::jsonb ? 'assistantCustomActions';
