-- Audit log of security-sensitive admin actions.
--
-- Append-only record of every change to authentication policy,
-- recovery codes, two-factor resets, and admin-driven role changes.
-- Read by compliance reviewers (SOC2 CC6.2 / CC7.2) and rendered in
-- the admin UI as a paginated, filterable feed.
--
-- Actor identity is denormalised (email, role, IP, UA) so removed
-- admins still leave a coherent trace. `actor_user_id` is nullable
-- with ON DELETE SET NULL so user deletion preserves the row.
--
-- Descending indexes on occurred_at let the UI's "newest first" feed
-- and the actor-/event-scoped filters serve directly from the index
-- without a sort pass.
CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "actor_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "actor_email" text,
  "actor_role" text,
  "actor_ip" text,
  "actor_user_agent" text,
  "event_type" text NOT NULL,
  "event_outcome" text NOT NULL DEFAULT 'success',
  "target_type" text,
  "target_id" text,
  "before_value" jsonb,
  "after_value" jsonb,
  "metadata" jsonb
);

CREATE INDEX "audit_log_occurred_at_idx"
  ON "audit_log" ("occurred_at" DESC);

CREATE INDEX "audit_log_actor_user_id_occurred_at_idx"
  ON "audit_log" ("actor_user_id", "occurred_at" DESC);

CREATE INDEX "audit_log_event_type_occurred_at_idx"
  ON "audit_log" ("event_type", "occurred_at" DESC);
