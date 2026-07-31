-- Workspace spam-filter configuration (JSON): { trustedSenders: string[] }.
-- Trusted senders (exact addresses or domains) bypass inbound spam
-- classification entirely. Null means the workspace has no overrides.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "spam_filter_config" text;
