-- Make user.email nullable and clean up synthetic emails
-- External users (Slack, etc.) may not have a real email address.

-- 1. Drop the old unique index (requires email to be non-null implicitly)
DROP INDEX IF EXISTS "user_email_idx";

-- 2. Make email nullable
ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;

-- 3. Create a partial unique index (only enforced for non-null emails)
CREATE UNIQUE INDEX "user_email_idx" ON "user" ("email") WHERE "email" IS NOT NULL;

-- 4. Nullify existing synthetic emails
UPDATE "user" SET "email" = NULL WHERE "email" LIKE '%@external.quackback.io';
