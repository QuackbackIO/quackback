CREATE TABLE "integration_platform_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_type" varchar(50) NOT NULL,
	"secrets" text NOT NULL,
	"configured_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_cred_type_unique" UNIQUE("integration_type")
);
--> statement-breakpoint
ALTER TABLE "integration_platform_credentials" ADD CONSTRAINT "integration_platform_credentials_configured_by_member_id_member_id_fk" FOREIGN KEY ("configured_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;