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

-- Remove the retired pre-consolidation feature alias without changing the
-- assistantTools umbrella used by built-in Writer actions.
UPDATE "settings"
SET "feature_flags" = ("feature_flags"::jsonb - 'dataConnectors')::text
WHERE "feature_flags" IS NOT NULL
  AND "feature_flags"::jsonb ? 'dataConnectors';
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
