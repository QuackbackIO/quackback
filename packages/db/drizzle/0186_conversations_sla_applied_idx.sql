-- The SLA sweep passes (sla.service.ts's sweepOverdueSlaBreaches plus the two
-- timer-trigger sweeps, sweepApproachingSlaBreaches / sweepSlaBreachTriggers)
-- all full-scan "conversations" on `sla_applied IS NOT NULL` as their base
-- filter, with every further predicate evaluated against JSON keys inside
-- that same column — no other single column narrows the scan further. A
-- partial index over the same predicate keeps that base filter an index
-- scan instead of a sequential scan on every sweep tick.
CREATE INDEX "conversations_sla_applied_idx" ON "conversations" USING btree ("id") WHERE sla_applied IS NOT NULL;
