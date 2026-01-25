-- Migration: Drop deprecated billing tables from tenant database
--
-- Billing has been moved to the catalog database (website codebase).
-- These tables were created in migration 0003 but are no longer used.
-- The subscription table in the catalog database now handles all billing.

-- Drop tables
DROP TABLE IF EXISTS "invoices";--> statement-breakpoint
DROP TABLE IF EXISTS "billing_subscriptions";--> statement-breakpoint

-- Drop indexes (if any remain after table drop)
DROP INDEX IF EXISTS "subscriptions_stripe_customer_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "subscriptions_stripe_subscription_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "invoices_stripe_invoice_idx";--> statement-breakpoint

-- Drop enums (order matters - must drop after tables that use them)
DROP TYPE IF EXISTS "invoice_status";--> statement-breakpoint
DROP TYPE IF EXISTS "subscription_status";--> statement-breakpoint
DROP TYPE IF EXISTS "cloud_tier";
