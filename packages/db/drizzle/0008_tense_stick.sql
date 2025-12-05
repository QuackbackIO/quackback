CREATE TABLE "session_transfer_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"target_domain" text NOT NULL,
	"callback_url" text NOT NULL,
	"context" text DEFAULT 'team' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_transfer_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "workspace_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"domain_type" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"verification_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domain_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "post_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"category" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"show_on_roadmap" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_transfer_token" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "oauth_transfer_token" CASCADE;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_auth_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_password_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_google_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_github_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_require_auth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_public_voting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_public_commenting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "theme_config" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_json" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "session_transfer_token" ADD CONSTRAINT "session_transfer_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domain" ADD CONSTRAINT "workspace_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_transfer_token_token_idx" ON "session_transfer_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "workspace_domain_org_id_idx" ON "workspace_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_statuses_org_slug_idx" ON "post_statuses" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "post_statuses_org_id_idx" ON "post_statuses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "post_statuses_position_idx" ON "post_statuses" USING btree ("organization_id","category","position");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_id_post_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_status_id_idx" ON "posts" USING btree ("status_id");--> statement-breakpoint
CREATE POLICY "post_statuses_tenant_isolation" ON "post_statuses" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));