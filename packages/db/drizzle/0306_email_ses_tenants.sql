-- @contract: additive
-- Per-workspace mail provider tenant state, used when the operator isolates
-- sending reputation per workspace. One row per tenant name; empty until the
-- reconcile job first runs, and on every install that leaves tenants off.
CREATE TABLE IF NOT EXISTS "email_ses_tenants" (
  "tenant_name" text PRIMARY KEY NOT NULL,
  "tenant_arn" text,
  "associated_arns" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "from_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "configuration_set" text,
  "ready_at" timestamptz,
  "sending_status" text,
  "status_cause" text,
  "status_checked_at" timestamptz,
  "paused_notified_at" timestamptz,
  "reconciled_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
