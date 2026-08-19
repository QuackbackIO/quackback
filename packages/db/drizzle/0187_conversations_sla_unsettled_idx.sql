-- Replaces conversations_sla_applied_idx (migration 0186, NEVER edit that
-- file). `sla_applied` is never cleared once an SLA settles — settle just
-- flips fields IN PLACE on the same JSON blob (sla.service.ts's SlaApplied:
-- firstResponseAt/resolvedAt/etc), the column itself stays non-null for the
-- conversation's whole remaining life — so `WHERE sla_applied IS NOT NULL`
-- selects a growing majority of the table over time and its selectivity as a
-- partial-index predicate degrades monotonically as a workspace ages.
--
-- All three SLA sweep passes (sla.service.ts's sweepOverdueSlaBreaches /
-- sweepApproachingSlaBreaches / sweepSlaBreachTriggers, via the shared
-- scanAndClaimSlaClocks) only ever care about a conversation with at least
-- one UNSETTLED clock (firstResponseAt or resolvedAt still null) — the real,
-- bounded candidate set every sweep re-derives from SLA_CLOCKS regardless of
-- which specific marker it's claiming — so the partial index predicate is
-- narrowed to match that instead. scanAndClaimSlaClocks' query repeats this
-- exact clause as an extra top-level AND (redundant given each sweep's own
-- OR'd window already implies it) so the planner can prove the index applies
-- via a literal clause match rather than relying on it to reason through the
-- OR structure itself.
DROP INDEX "conversations_sla_applied_idx";

CREATE INDEX "conversations_sla_unsettled_idx" ON "conversations" USING btree ("id")
  WHERE sla_applied IS NOT NULL
    AND ((sla_applied ->> 'firstResponseAt') IS NULL OR (sla_applied ->> 'resolvedAt') IS NULL);
