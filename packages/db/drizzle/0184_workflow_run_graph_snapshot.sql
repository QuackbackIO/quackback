-- A run's cursor only ever stored resumeNodeId; resumeWorkflowRun re-read the
-- LIVE workflow's graph at resume time, so editing a workflow while a run sat
-- parked at a wait made the resumed run walk arbitrary new logic, and
-- deleting the resume node silently settled the run done. Runs must instead
-- pin to the graph they started with. Graphs are capped at 200 nodes / 400
-- edges (a few KB), so duplicating one onto every run is cheap. Defaulted
-- like workflows.graph so existing rows (and any fixture that inserts a run
-- directly, not caring about the graph) backfill to an empty graph rather
-- than requiring a rewrite.
ALTER TABLE "workflow_runs" ADD COLUMN "graph" jsonb DEFAULT '{}'::jsonb NOT NULL;
