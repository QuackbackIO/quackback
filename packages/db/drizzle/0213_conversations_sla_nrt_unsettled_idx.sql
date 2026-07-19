-- Widens conversations_sla_unsettled_idx (0187, NEVER edit that file) for the
-- next-response clock. rearmNextResponse (sla.service.ts) can arm an NRT cycle
-- (nextResponseDueAt set, nextResponseAt null) on a conversation whose
-- first-response AND resolution clocks already settled — e.g. a customer
-- re-pinging a reopened, resolved thread — a row 0187's two-arm predicate
-- excludes, so the three SLA sweeps would never scan that armed clock (and
-- widening the scan WITHOUT the index would throw away the selectivity 0187
-- was created for). The NRT arm is `dueAt set AND unsettled`, not bare
-- `nextResponseAt IS NULL`: that outcome is absent-until-settled, so the bare
-- form would be true for nearly every stamp and degrade the partial index back
-- to 0186's `IS NOT NULL` selectivity. scanAndClaimSlaClocks' query repeats
-- this exact clause as an extra top-level AND so the planner can prove the
-- index applies via a literal clause match.
DROP INDEX "conversations_sla_unsettled_idx";
--> statement-breakpoint
CREATE INDEX "conversations_sla_unsettled_idx" ON "conversations" USING btree ("id")
  WHERE sla_applied IS NOT NULL
    AND ((sla_applied ->> 'firstResponseAt') IS NULL
      OR (sla_applied ->> 'resolvedAt') IS NULL
      OR ((sla_applied ->> 'nextResponseDueAt') IS NOT NULL AND (sla_applied ->> 'nextResponseAt') IS NULL));
