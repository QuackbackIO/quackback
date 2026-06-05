-- Targeted indexes for two analytics queries that previously full-scanned
-- growing tables on every dashboard load.
--
-- 1. session_updatedAt_idx
--    Backs the active-users query: counts distinct users whose session
--    updated_at falls within the selected period. updated_at is refreshed on
--    activity, so this range predicate is the most selective filter; without
--    an index the planner seq-scans the whole session table before joining.
CREATE INDEX "session_updatedAt_idx" ON "session" USING btree ("updated_at");--> statement-breakpoint
-- 2. comments_status_change_to_id_idx
--    Backs the time-to-resolution query, which joins comments to post_statuses
--    via status_change_to_id. That column is NULL on ordinary comments (set
--    only when a team member changes status through a comment), so the partial
--    index stays tiny and lets the planner skip every non-status-change row.
CREATE INDEX "comments_status_change_to_id_idx" ON "comments" USING btree ("status_change_to_id") WHERE status_change_to_id IS NOT NULL;
