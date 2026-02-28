CREATE TABLE "feedback_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"suggestion_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"raw_feedback_item_id" uuid NOT NULL,
	"signal_id" uuid,
	"board_id" uuid,
	"target_post_id" uuid,
	"similarity_score" real,
	"suggested_title" text,
	"suggested_body" text,
	"reasoning" text,
	"embedding" vector(1536),
	"result_post_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_suggestions" ADD CONSTRAINT "feedback_suggestions_raw_feedback_item_id_raw_feedback_items_id_fk" FOREIGN KEY ("raw_feedback_item_id") REFERENCES "public"."raw_feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_suggestions" ADD CONSTRAINT "feedback_suggestions_signal_id_feedback_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."feedback_signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_suggestions" ADD CONSTRAINT "feedback_suggestions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_suggestions" ADD CONSTRAINT "feedback_suggestions_target_post_id_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_suggestions" ADD CONSTRAINT "feedback_suggestions_result_post_id_posts_id_fk" FOREIGN KEY ("result_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_suggestions" ADD CONSTRAINT "feedback_suggestions_resolved_by_principal_id_principal_id_fk" FOREIGN KEY ("resolved_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_suggestions_status_idx" ON "feedback_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_suggestions_type_idx" ON "feedback_suggestions" USING btree ("suggestion_type");--> statement-breakpoint
CREATE INDEX "feedback_suggestions_raw_item_idx" ON "feedback_suggestions" USING btree ("raw_feedback_item_id");--> statement-breakpoint
CREATE INDEX "feedback_suggestions_target_post_idx" ON "feedback_suggestions" USING btree ("target_post_id");--> statement-breakpoint
CREATE INDEX "feedback_suggestions_created_idx" ON "feedback_suggestions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_suggestions_pending_merge_idx" ON "feedback_suggestions" USING btree ("raw_feedback_item_id","target_post_id") WHERE "feedback_suggestions"."status" = 'pending' AND "feedback_suggestions"."target_post_id" IS NOT NULL;