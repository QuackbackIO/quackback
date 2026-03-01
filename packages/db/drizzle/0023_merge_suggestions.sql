CREATE TABLE "merge_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_post_id" uuid NOT NULL,
	"target_post_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"vector_score" real NOT NULL,
	"fts_score" real NOT NULL,
	"hybrid_score" real NOT NULL,
	"llm_confidence" real NOT NULL,
	"llm_reasoning" text,
	"llm_model" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "merge_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_source_post_id_posts_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_target_post_id_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_resolved_by_principal_id_principal_id_fk" FOREIGN KEY ("resolved_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merge_suggestions_source_post_idx" ON "merge_suggestions" USING btree ("source_post_id");--> statement-breakpoint
CREATE INDEX "merge_suggestions_target_post_idx" ON "merge_suggestions" USING btree ("target_post_id");--> statement-breakpoint
CREATE INDEX "merge_suggestions_status_idx" ON "merge_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "merge_suggestions_created_idx" ON "merge_suggestions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_suggestions_pending_unique_idx" ON "merge_suggestions" USING btree ("source_post_id","target_post_id") WHERE "merge_suggestions"."status" = 'pending';
