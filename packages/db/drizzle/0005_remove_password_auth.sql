-- Remove password authentication columns from organization table
-- Password auth has been replaced with email OTP codes

ALTER TABLE "organization" DROP COLUMN IF EXISTS "password_auth_enabled";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "portal_password_enabled";
