-- Remove workflow state that still depends on call_connector. Current
-- connector-backed workflows are removed with all of their children; stale
-- run/version snapshots are removed without deleting workflows that were
-- already edited to use only built-in steps.
DELETE FROM "workflow_run_events"
WHERE "workflow_id" IN (
  SELECT "id"
  FROM "workflows"
  WHERE "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb
)
OR "run_id" IN (
  SELECT "id"
  FROM "workflow_runs"
  WHERE "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb
);
--> statement-breakpoint
DELETE FROM "workflow_runs"
WHERE "workflow_id" IN (
  SELECT "id"
  FROM "workflows"
  WHERE "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb
)
OR "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb;
--> statement-breakpoint
DELETE FROM "workflow_versions"
WHERE "workflow_id" IN (
  SELECT "id"
  FROM "workflows"
  WHERE "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb
)
OR "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb;
--> statement-breakpoint
DELETE FROM "workflows"
WHERE "graph" @> '{"nodes":[{"type":"call_connector"}]}'::jsonb;
--> statement-breakpoint

-- Connector tools were persisted by their connector_ prefix. Remove both
-- audit/proposal rows and V2 per-tool controls while retaining built-in Writer
-- action controls under assistantTools.
DELETE FROM "assistant_tool_calls"
WHERE left("tool_name", 10) = 'connector_';
--> statement-breakpoint
DELETE FROM "assistant_pending_actions"
WHERE left("tool_name", 10) = 'connector_';
--> statement-breakpoint
UPDATE "settings" AS "s"
SET
  "assistant_config" = jsonb_set(
    "s"."assistant_config",
    '{toolControls}',
    COALESCE(
      (
        SELECT jsonb_object_agg("control"."key", "control"."value")
        FROM jsonb_each("s"."assistant_config"->'toolControls') AS "control"
        WHERE left("control"."key", 10) <> 'connector_'
      ),
      '{}'::jsonb
    )
  ),
  "assistant_config_revision" = "s"."assistant_config_revision" + 1
WHERE jsonb_typeof("s"."assistant_config"->'toolControls') = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each("s"."assistant_config"->'toolControls') AS "control"
    WHERE left("control"."key", 10) = 'connector_'
  );
--> statement-breakpoint

-- Safe reader for the settings.feature_flags text column: the parsed object,
-- or NULL for NULL, blank, unparseable or non-object content (the app reads
-- all of those as default flags), so one corrupt blob is skipped instead of
-- aborting the whole upgrade. Session-scoped; gone when the migration session
-- ends.
CREATE OR REPLACE FUNCTION pg_temp._m0197_feature_flags(raw text) RETURNS jsonb AS $$
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

-- Remove the retired pre-consolidation feature alias without changing the
-- assistantTools umbrella used by built-in Writer actions.
UPDATE "settings"
SET "feature_flags" = (pg_temp._m0197_feature_flags("feature_flags") - 'dataConnectors')::text
WHERE pg_temp._m0197_feature_flags("feature_flags") ? 'dataConnectors';
--> statement-breakpoint

-- Remove persisted grants before deleting the code-retired permission row.
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "key" = 'connector.manage'
);
--> statement-breakpoint
DELETE FROM "permissions" WHERE "key" = 'connector.manage';
--> statement-breakpoint

DROP INDEX IF EXISTS "data_connectors_enabled_status_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "data_connectors";
