-- @contract: additive
-- Sending domain setup v1: stored MAIL FROM label, automatic check window,
-- pre-flight results, and how the domain is signed. Existing domains keep the
-- label they were verified with and stay on the provider's own DKIM keys
-- ('easy'); new ones are created with a key of their own ('byo'), or keep the
-- key an identity that already existed signs with ('shared'). A 'shared' row
-- whose identity signs with a key nobody can publish holds its own key,
-- encrypted, until it proves ownership and the identity is re-keyed to it.
ALTER TABLE "email_sending_domains"
  ADD COLUMN IF NOT EXISTS "mail_from_label" text NOT NULL DEFAULT 'bounce',
  ADD COLUMN IF NOT EXISTS "auto_check_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "preflight" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "dkim_mode" text NOT NULL DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS "pending_signing_key" text;

-- Domains still pending from before the window existed get one from now, so
-- they are checked automatically like a domain added today. The UPDATE sits in
-- a DO block so a fleet replay is a no-op: it fills only NULL windows and
-- leaves none behind, and the app sets the window on every row it creates.
-- @replay: guarded-by auto_check_until being NULL; a row it updates ends with a window and is not matched again
DO $$
BEGIN
  UPDATE "email_sending_domains"
  SET "auto_check_until" = now() + interval '72 hours'
  WHERE "status" = 'pending' AND "auto_check_until" IS NULL;
END $$;
