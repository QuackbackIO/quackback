ALTER TABLE "organization" ADD COLUMN "password_auth_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "google_oauth_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "github_oauth_enabled" boolean DEFAULT true NOT NULL;