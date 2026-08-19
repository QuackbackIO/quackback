-- Data Connector v0: admin-defined external API calls the AI assistant can
-- call as tools. Each enabled row becomes a model-facing tool named
-- `connector_{slug}` (connectors domain, apps/web). The secret is write-only:
-- encrypted at rest, never read back out of this table by the app layer.
CREATE TABLE "data_connectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"method" text NOT NULL,
	"url_template" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL,
	"secret_ciphertext" text,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_template" text,
	"example_response" jsonb,
	"response_paths" jsonb,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_tested_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_connectors_name_unique" UNIQUE("name"),
	CONSTRAINT "data_connectors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "data_connectors"
	ADD CONSTRAINT "data_connectors_created_by_id_principal_id_fk"
	FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_connectors"
	ADD CONSTRAINT "data_connectors_method_check" CHECK ("method" IN ('GET','POST'));
--> statement-breakpoint
ALTER TABLE "data_connectors"
	ADD CONSTRAINT "data_connectors_status_check" CHECK ("status" IN ('active','disabled'));
--> statement-breakpoint
ALTER TABLE "data_connectors"
	ADD CONSTRAINT "data_connectors_timeout_ms_check" CHECK ("timeout_ms" <= 30000);
--> statement-breakpoint
CREATE INDEX "data_connectors_enabled_status_idx" ON "data_connectors" USING btree ("enabled","status");
