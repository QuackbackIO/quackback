-- Migration: Add billing tables to catalog database
-- This migration adds subscription, invoice, and stripe_customer tables
-- to support centralized billing in the catalog database.

-- Stripe customer → workspace mapping
CREATE TABLE IF NOT EXISTS stripe_customer (
  stripe_customer_id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stripe_customer_workspace_idx ON stripe_customer(workspace_id);

-- Subscription table (one per workspace)
CREATE TABLE IF NOT EXISTS subscription (
  id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  seats_included INTEGER NOT NULL DEFAULT 1,
  seats_additional INTEGER NOT NULL DEFAULT 0,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscription_workspace_idx ON subscription(workspace_id);
CREATE INDEX IF NOT EXISTS subscription_stripe_customer_idx ON subscription(stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_workspace_unique ON subscription(workspace_id);

-- Invoice table (multiple per workspace)
CREATE TABLE IF NOT EXISTS invoice (
  id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  amount_due INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,
  invoice_url TEXT,
  pdf_url TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_workspace_idx ON invoice(workspace_id);
CREATE INDEX IF NOT EXISTS invoice_stripe_invoice_idx ON invoice(stripe_invoice_id);
