-- Webhooks table for external event notifications
-- Webhook endpoints are triggered when events occur in Quackback

CREATE TABLE IF NOT EXISTS "webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_by_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"board_ids" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_id_member_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_status_idx" ON "webhooks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_created_by_id_idx" ON "webhooks" USING btree ("created_by_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_events_idx" ON "webhooks" USING gin ("events");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_board_ids_idx" ON "webhooks" USING gin ("board_ids");
