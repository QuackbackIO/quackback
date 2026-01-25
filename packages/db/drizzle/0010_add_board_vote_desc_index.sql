-- Optimized indexes for "top posts" and "new posts" queries that ORDER BY DESC
-- The existing posts_board_vote_idx is ascending, requiring backward scans
-- These DESC indexes allow PostgreSQL to scan from highest values, stopping early after LIMIT
-- Note: Cannot use CONCURRENTLY because Drizzle migrations run in transactions

-- Index for vote_count DESC (used by "top" sort)
CREATE INDEX IF NOT EXISTS "posts_board_vote_desc_idx"
ON "posts" ("board_id", "vote_count" DESC);--> statement-breakpoint

-- Index for created_at DESC (used by "new" sort)
CREATE INDEX IF NOT EXISTS "posts_board_created_desc_idx"
ON "posts" ("board_id", "created_at" DESC);
