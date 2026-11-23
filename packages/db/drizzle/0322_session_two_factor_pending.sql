-- @contract: additive
-- A session issued by a password sign-in (or sign-up) while the workspace
-- requires two-factor authentication and the person has not enrolled yet. It
-- may only finish enrolment or sign out; every other read treats it as no
-- session. Enrolment replaces it with an ordinary session, which defaults to
-- false, as does every row written before this column existed.
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "two_factor_pending" boolean DEFAULT false NOT NULL;
