-- Speeds up the per-month chat-completion counter that backs the
-- aiOpsPerMonth tier quota. Embeddings and failed calls are excluded
-- via the partial index WHERE; the query uses
--   created_at >= date_trunc('month', now())
-- so the index range scan is bounded.
--
-- date_trunc(text, timestamptz) is not IMMUTABLE so it can't appear in
-- the index expression itself. Index on created_at and let the planner
-- use a range predicate instead.
CREATE INDEX IF NOT EXISTS "ai_usage_log_month_chat_idx"
  ON "ai_usage_log" ("created_at")
  WHERE "call_type" = 'chat_completion' AND "status" = 'success';
