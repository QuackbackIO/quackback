-- @contract: safe-after 0.13.2   (billing state moved to the control-plane
-- projection in 0262; no workspace code reads these tables)
DROP TABLE IF EXISTS "billing_webhook_events";
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_usage_events";
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_subscription_state";
