-- @contract: additive
-- The workspace's language settings as JSON: the main language it writes in,
-- and whether visitors see their own language or the main language. NULL means
-- the defaults: the help center's default language (English unless changed)
-- and each visitor's own language, so existing workspaces see no change.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "language_config" text;
