-- @contract: additive
-- The name and avatar URL an identity provider last wrote to an account's
-- user, each kept only while the user's stored value still equals it. Profile
-- sync on sign-in refreshes a recorded field and never one a person chose in
-- Quackback. A missing row means nothing is known to be provider-set.
-- Its own table, not columns on "account": the auth adapter selects every
-- "account" column, so a column there would fail sign-in on any database that
-- has not applied this migration yet.
CREATE TABLE IF NOT EXISTS "account_profile_sync" ("account_id" uuid PRIMARY KEY REFERENCES "account"("id") ON DELETE CASCADE, "name" text, "image" text, "updated_at" timestamptz NOT NULL DEFAULT now());
