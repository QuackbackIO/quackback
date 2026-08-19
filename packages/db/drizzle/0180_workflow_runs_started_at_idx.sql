-- workflowEffectiveness (workflow-reporting.ts) filters workflow_runs by a
-- started_at range with no supporting index, forcing a full scan on every
-- report request. This is the sole predicate (no other column narrows it),
-- so a plain btree index on started_at serves it directly.
CREATE INDEX "workflow_runs_started_at_idx" ON "workflow_runs" USING btree ("started_at");
