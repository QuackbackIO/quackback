-- Portal authentication settings (separate from team auth)
ALTER TABLE "organization" ADD COLUMN "portal_auth_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "organization" ADD COLUMN "portal_password_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "organization" ADD COLUMN "portal_google_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "organization" ADD COLUMN "portal_github_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "organization" ADD COLUMN "portal_require_auth" boolean DEFAULT false NOT NULL;
