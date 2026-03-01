CREATE TABLE "external_user_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"external_user_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"external_name" text,
	"external_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_signal_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"signal_id" uuid NOT NULL,
	"corrected_by_principal_id" uuid NOT NULL,
	"field" varchar(30) NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"raw_feedback_item_id" uuid NOT NULL,
	"signal_type" varchar(30) NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"implicit_need" text,
	"sentiment" varchar(10),
	"urgency" varchar(10),
	"board_id" uuid,
	"theme_id" uuid,
	"extraction_confidence" real NOT NULL,
	"interpretation_confidence" real,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_updated_at" timestamp with time zone,
	"processing_state" varchar(30) DEFAULT 'pending_interpretation' NOT NULL,
	"extraction_model" text,
	"extraction_prompt_version" varchar(20),
	"interpretation_model" text,
	"interpretation_prompt_version" varchar(20),
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_confidence_range" CHECK ("feedback_signals"."extraction_confidence" >= 0 and "feedback_signals"."extraction_confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "feedback_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"delivery_mode" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"integration_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" text,
	"cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_sources_error_count_non_negative" CHECK (error_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "feedback_themes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"parent_theme_id" uuid,
	"board_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"merged_into_theme_id" uuid,
	"strength" real DEFAULT 0 NOT NULL,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"unique_author_count" integer DEFAULT 0 NOT NULL,
	"centroid_embedding" vector(1536),
	"centroid_model" text,
	"centroid_updated_at" timestamp with time zone,
	"sentiment_distribution" jsonb,
	"urgency_distribution" jsonb,
	"promoted_to_post_id" uuid,
	"first_signal_at" timestamp with time zone,
	"last_signal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_feedback_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"external_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"external_url" text,
	"source_created_at" timestamp with time zone NOT NULL,
	"author" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"context_envelope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_state" varchar(30) DEFAULT 'pending_context' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"principal_id" uuid,
	"extraction_input_tokens" integer,
	"extraction_output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "promoted_from_theme_id" uuid;--> statement-breakpoint
ALTER TABLE "external_user_mappings" ADD CONSTRAINT "external_user_mappings_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_signal_corrections" ADD CONSTRAINT "feedback_signal_corrections_signal_id_feedback_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."feedback_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_signal_corrections" ADD CONSTRAINT "feedback_signal_corrections_corrected_by_principal_id_principal_id_fk" FOREIGN KEY ("corrected_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_signals" ADD CONSTRAINT "feedback_signals_raw_feedback_item_id_raw_feedback_items_id_fk" FOREIGN KEY ("raw_feedback_item_id") REFERENCES "public"."raw_feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_signals" ADD CONSTRAINT "feedback_signals_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_signals" ADD CONSTRAINT "feedback_signals_theme_id_feedback_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."feedback_themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_sources" ADD CONSTRAINT "feedback_sources_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_themes" ADD CONSTRAINT "feedback_themes_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_feedback_items" ADD CONSTRAINT "raw_feedback_items_source_id_feedback_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."feedback_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_feedback_items" ADD CONSTRAINT "raw_feedback_items_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_user_source_idx" ON "external_user_mappings" USING btree ("source_type","external_user_id");--> statement-breakpoint
CREATE INDEX "external_user_principal_idx" ON "external_user_mappings" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "feedback_signal_corrections_signal_idx" ON "feedback_signal_corrections" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "feedback_signals_raw_idx" ON "feedback_signals" USING btree ("raw_feedback_item_id");--> statement-breakpoint
CREATE INDEX "feedback_signals_theme_idx" ON "feedback_signals" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "feedback_signals_board_idx" ON "feedback_signals" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "feedback_signals_state_idx" ON "feedback_signals" USING btree ("processing_state");--> statement-breakpoint
CREATE INDEX "feedback_sources_type_idx" ON "feedback_sources" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "feedback_sources_enabled_idx" ON "feedback_sources" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "feedback_themes_board_idx" ON "feedback_themes" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "feedback_themes_strength_idx" ON "feedback_themes" USING btree ("strength");--> statement-breakpoint
CREATE INDEX "feedback_themes_last_signal_idx" ON "feedback_themes" USING btree ("last_signal_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_feedback_dedupe_idx" ON "raw_feedback_items" USING btree ("source_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "raw_feedback_state_idx" ON "raw_feedback_items" USING btree ("processing_state");--> statement-breakpoint
CREATE INDEX "raw_feedback_source_type_idx" ON "raw_feedback_items" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "raw_feedback_created_idx" ON "raw_feedback_items" USING btree ("created_at");