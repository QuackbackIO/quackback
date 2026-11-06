-- @contract: additive
-- API keys come in two kinds. A personal key acts as the teammate who made it
-- and stops working when they leave. A workspace key has its own role, held as
-- a workspace role assignment on the key's service principal, and belongs to
-- nobody. Every existing key is a personal key.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'personal' NOT NULL
  CHECK ("kind" IN ('personal', 'workspace'));
