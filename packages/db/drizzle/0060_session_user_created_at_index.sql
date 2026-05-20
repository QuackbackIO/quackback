-- Composite index for the team-list `max(session.created_at) GROUP BY
-- user_id` aggregate. Without it the planner scans every session row
-- per user via the existing `session_userId_idx`; with it the planner
-- can do an index-only scan and stop at the first row per group.
CREATE INDEX IF NOT EXISTS "session_userId_createdAt_idx"
  ON "session" ("user_id", "created_at" DESC);
