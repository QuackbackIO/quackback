-- Guidance rules: short admin-authored directives Quinn's prompt assembly
-- folds in alongside its system prompt. NULL surfaces = applies everywhere;
-- position drives both prompt-assembly order and the admin reorder UI.
CREATE TABLE "assistant_guidance_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"surfaces" text[],
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules"
	ADD CONSTRAINT "assistant_guidance_rules_created_by_id_principal_id_fk"
	FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules"
	ADD CONSTRAINT "assistant_guidance_rules_title_length_check" CHECK (char_length("title") <= 80);
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules"
	ADD CONSTRAINT "assistant_guidance_rules_body_length_check" CHECK (char_length("body") <= 1000);
--> statement-breakpoint
CREATE INDEX "assistant_guidance_rules_enabled_position_idx" ON "assistant_guidance_rules" USING btree ("enabled","position");
