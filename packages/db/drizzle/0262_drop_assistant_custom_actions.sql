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
-- Safe reader for the settings.feature_flags text column: the parsed object,
-- or NULL for NULL, blank, unparseable or non-object content (the app reads
-- all of those as default flags), so one corrupt blob is skipped instead of
-- aborting the whole upgrade. Session-scoped; gone when the migration session
-- ends.
CREATE OR REPLACE FUNCTION pg_temp._m0262_feature_flags(raw text) RETURNS jsonb AS $$
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
UPDATE "settings"
SET "feature_flags" = (pg_temp._m0262_feature_flags("feature_flags") - 'assistantCustomActions')::text
WHERE pg_temp._m0262_feature_flags("feature_flags") ? 'assistantCustomActions';
