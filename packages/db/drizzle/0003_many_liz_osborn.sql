CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"provider_id" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sso_provider_org_id_idx" ON "sso_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_provider_domain_idx" ON "sso_provider" USING btree ("domain");