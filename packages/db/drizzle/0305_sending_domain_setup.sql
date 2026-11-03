-- @contract: additive
-- Sending domain setup v1: stored MAIL FROM label, automatic check window,
-- and pre-flight results. Existing domains keep the label they were verified
-- with.
ALTER TABLE "email_sending_domains"
  ADD COLUMN IF NOT EXISTS "mail_from_label" text NOT NULL DEFAULT 'bounce',
  ADD COLUMN IF NOT EXISTS "auto_check_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "preflight" jsonb NOT NULL DEFAULT '{}'::jsonb;
