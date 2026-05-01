-- Speeds up the per-month chat-completion counter that backs the
-- aiOpsPerMonth tier quota. Embeddings and failed calls are excluded
-- via the partial WHERE; the query in apps/web/src/lib/server/domains/ai/usage-counter.ts
-- uses created_at >= date_trunc('month', now()) so the planner can
-- range-scan the partial index.
CREATE INDEX IF NOT EXISTS "ai_usage_log_month_chat_idx"
  ON "ai_usage_log" ("created_at")
  WHERE "call_type" = 'chat_completion' AND "status" = 'success';
