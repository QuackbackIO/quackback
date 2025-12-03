-- Migration: Tenant Isolation
-- Migrates from hub-and-spoke to full tenant isolation model

-- Step 1: Create OAuth transfer token table
CREATE TABLE "oauth_transfer_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"target_subdomain" text NOT NULL,
	"callback_url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_transfer_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint

-- Step 2: Add open signup setting to organization
ALTER TABLE "organization" ADD COLUMN "open_signup_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Step 3: Add organization_id to user (nullable initially for backfill)
ALTER TABLE "user" ADD COLUMN "organization_id" text;
--> statement-breakpoint

-- Step 4: Backfill organization_id from member table (use first/oldest membership)
UPDATE "user" u SET "organization_id" = (
  SELECT m."organization_id" FROM "member" m
  WHERE m."user_id" = u."id"
  ORDER BY m."created_at" ASC
  LIMIT 1
)
WHERE u."organization_id" IS NULL;
--> statement-breakpoint

-- Step 5: Delete orphaned users (users with no organization membership)
-- This is a destructive operation - users without org membership are removed
DELETE FROM "user" WHERE "organization_id" IS NULL;
--> statement-breakpoint

-- Step 6: Make organization_id required
ALTER TABLE "user" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint

-- Step 7: Drop global email unique constraint
ALTER TABLE "user" DROP CONSTRAINT "user_email_unique";
--> statement-breakpoint

-- Step 8: Add composite unique constraint (email + org)
CREATE UNIQUE INDEX "user_email_org_unique_idx" ON "user" USING btree ("email","organization_id");
--> statement-breakpoint

-- Step 9: Add index on organization_id for fast lookups
CREATE INDEX "user_organization_id_idx" ON "user" USING btree ("organization_id");
--> statement-breakpoint

-- Step 10: Add foreign key and indexes for oauth_transfer_token
ALTER TABLE "oauth_transfer_token" ADD CONSTRAINT "oauth_transfer_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "oauth_transfer_token_token_idx" ON "oauth_transfer_token" USING btree ("token");
