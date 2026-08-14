CREATE TABLE "assistant_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"transport" text DEFAULT 'http' NOT NULL,
	"url" text NOT NULL,
	"auth_token_ciphertext" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assignments" jsonb DEFAULT '{"agent":true,"copilot":true}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_connectors" ADD CONSTRAINT "assistant_connectors_created_by_id_principal_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_connectors_slug_unique" ON "assistant_connectors" USING btree (lower("slug"));
--> statement-breakpoint
CREATE INDEX "assistant_connectors_enabled_idx" ON "assistant_connectors" USING btree ("enabled");
