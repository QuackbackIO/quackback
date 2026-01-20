-- Migration: Initial catalog database schema
-- Creates the base tables for workspace management:
-- - workspace: Core workspace metadata
-- - workspace_domain: Domain mappings (subdomains and custom domains)
-- - verification: Email verification codes for signup

-- Workspace table
CREATE TABLE IF NOT EXISTS workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  neon_project_id TEXT,
  neon_region TEXT DEFAULT 'aws-us-east-1',
  migration_status TEXT DEFAULT 'pending'
);

-- Workspace domain table
CREATE TABLE IF NOT EXISTS workspace_domain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  domain TEXT NOT NULL UNIQUE,
  domain_type TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_token TEXT,
  cloudflare_hostname_id TEXT,
  ssl_status TEXT,
  ownership_status TEXT
);

CREATE INDEX IF NOT EXISTS workspace_domain_workspace_id_idx ON workspace_domain(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_domain_cf_hostname_id_idx ON workspace_domain(cloudflare_hostname_id);

-- Verification table
CREATE TABLE IF NOT EXISTS verification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE UNIQUE INDEX IF NOT EXISTS verification_identifier_unique ON verification(identifier);
