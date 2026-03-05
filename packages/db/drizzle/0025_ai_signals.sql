CREATE TABLE "ai_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"post_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_signals" ADD CONSTRAINT "ai_signals_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_signals" ADD CONSTRAINT "ai_signals_resolved_by_principal_id_principal_id_fk" FOREIGN KEY ("resolved_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_signals_post_id_idx" ON "ai_signals" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "ai_signals_type_status_idx" ON "ai_signals" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "ai_signals_status_created_idx" ON "ai_signals" USING btree ("status","created_at");
--> statement-breakpoint
-- Backfill: create duplicate signals for existing pending merge suggestions
INSERT INTO "ai_signals" ("id", "type", "severity", "post_id", "payload", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'duplicate',
  'info',
  ms."target_post_id",
  jsonb_build_object(
    'matchedPostId', ms."source_post_id"::text,
    'confidence', ms."llm_confidence"
  ),
  'pending',
  ms."created_at",
  ms."updated_at"
FROM "merge_suggestions" ms
WHERE ms."status" = 'pending';
