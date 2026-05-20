-- Idempotency table for BullMQ hook handlers (webhooks, AI, etc).
-- Handlers INSERT … ON CONFLICT DO NOTHING keyed on the BullMQ job_id
-- before doing any side-effecting work. A conflict means the job has
-- already been processed (e.g. worker crashed after the side-effect but
-- before the BullMQ ack), so the handler returns early instead of
-- re-firing the webhook or re-billing OpenAI.
CREATE TABLE IF NOT EXISTS "hook_deliveries" (
  "job_id" text PRIMARY KEY,
  "hook_type" text NOT NULL,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hook_deliveries_processed_at_idx"
  ON "hook_deliveries" ("processed_at");
