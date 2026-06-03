ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "request_id" text;
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_type" text;
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "auth_method" text;
CREATE INDEX IF NOT EXISTS "audit_log_request_id_idx" ON "audit_log" ("request_id");
