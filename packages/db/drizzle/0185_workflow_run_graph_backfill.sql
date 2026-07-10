-- 0184 added workflow_runs.graph with a bare '{}' default and no backfill.
-- Any run that was parked `waiting` before that migration deployed carries
-- an empty snapshot: resumeWorkflowRun walks readGraph('{}') via graph.ts,
-- finds no nodes, and the run silently settles done, dropping whatever
-- actions were still queued past the wait. Backfill those rows from the
-- parent workflow's current graph (the closest available approximation of
-- the graph the run actually started against) so waiting runs resume into
-- real logic instead of nothing. Rows that already have a real snapshot
-- (anything but the literal default) are left untouched.
UPDATE "workflow_runs"
SET "graph" = "workflows"."graph"
FROM "workflows"
WHERE "workflow_runs"."workflow_id" = "workflows"."id"
  AND "workflow_runs"."graph" = '{}'::jsonb;
