-- Ticket activity log: tracks all meaningful state changes on tickets
-- (mirrors post_activity, the posts-side log)
CREATE TABLE "ticket_activity" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "principal_id" uuid,
  "type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_activity"
  ADD CONSTRAINT "ticket_activity_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_activity"
  ADD CONSTRAINT "ticket_activity_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_activity_ticket_id_created_idx"
  ON "ticket_activity" USING btree ("ticket_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ticket_activity_type_idx"
  ON "ticket_activity" USING btree ("type");
