-- @contract: additive
-- Per-use connector policies (QUINN-PRODUCT connection gate). Expand-only and
-- replay-safe: every statement is ADD COLUMN IF NOT EXISTS, so a second run
-- against a database that already carries the effect changes nothing.
--
-- No backfill runs here on purpose. The legacy shared `tool_policies` map is
-- projected into `profile_policies` (and the current tool contracts into
-- `tool_reviews`) lazily, in code, the first time a connector row is read:
-- see `ensureConnectorPolicyState` in connectors.service.ts. NULL is the
-- "not projected yet" sentinel, which is why neither column has a default.
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "profile_policies" jsonb;
--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "tool_reviews" jsonb;
--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "catalog_revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "policy_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- The origin profile a proposal was made under, kept immutable so approving a
-- customer-origin request never re-resolves it as a teammate one, plus the
-- connector policy version it was proposed under, so the approval executor can
-- tell "unchanged" from "changed since".
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "origin_profile" text;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "policy_version" integer;
