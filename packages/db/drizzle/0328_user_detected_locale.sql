-- @contract: additive
-- The language a person's browser, or the host page's widget locale, asked
-- for at their latest sign-in or widget identify, and when it last changed.
-- Emails use it when the person has not chosen a language. Null until the
-- next sign-in or identify records one.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "detected_locale" text,
  ADD COLUMN IF NOT EXISTS "detected_locale_at" timestamptz;
