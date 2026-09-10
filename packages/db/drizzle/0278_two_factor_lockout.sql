-- better-auth 1.6.30 twoFactor account-lockout columns. The plugin writes
-- failed_verification_count / locked_until on every TOTP verify (success
-- and failure). Without matching Drizzle fields the adapter emits
-- `update "two_factor" set  where …` and enrolment / sign-in 500. See #432.
-- Additive / expand-only.
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "failed_verification_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "locked_until" timestamptz;
