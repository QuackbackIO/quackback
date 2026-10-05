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
--> statement-breakpoint

-- Safe reader for the settings.feature_flags text column: the parsed object,
-- or NULL for NULL, blank, unparseable or non-object content (the app reads
-- all of those as default flags), so one corrupt blob is skipped instead of
-- aborting the whole upgrade. Session-scoped; gone when the migration session
-- ends.
CREATE OR REPLACE FUNCTION pg_temp._m0220_feature_flags(raw text) RETURNS jsonb AS $$
DECLARE
  parsed jsonb;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
  parsed := raw::jsonb;
  IF jsonb_typeof(parsed) <> 'object' THEN RETURN NULL; END IF;
  RETURN parsed;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Obsolete feature-flag key (feature_flags is JSON stored as text).
UPDATE "settings"
SET "feature_flags" = (pg_temp._m0220_feature_flags("feature_flags") - 'assistantCustomActions')::text
WHERE pg_temp._m0220_feature_flags("feature_flags") ? 'assistantCustomActions';
