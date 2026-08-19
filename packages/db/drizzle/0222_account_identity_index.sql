-- Index the account identity key so duplicates can be found cheaply.
--
-- `account` carries exactly one index today, on (user_id, created_at). Nothing
-- constrains (provider_id, account_id) or (user_id, provider_id), so a change
-- in which claim supplies the account identifier can silently create a second
-- account row — or, for a provider with no email, fork the user. Neither is
-- undone by rolling an image back.
--
-- Deliberately NOT UNIQUE. This ships to self-hosted installations we cannot
-- inspect, and a unique index would abort the migration wherever duplicates
-- already exist, turning a latent data issue into a failed upgrade that takes
-- the whole instance down. Detect first, constrain later: the index makes the
-- detection query cheap, and the constraint can follow once the real rate is
-- known from installations we can observe.
CREATE INDEX IF NOT EXISTS "account_provider_account_idx"
  ON "account" ("provider_id", "account_id");

CREATE INDEX IF NOT EXISTS "account_user_provider_idx"
  ON "account" ("user_id", "provider_id");
