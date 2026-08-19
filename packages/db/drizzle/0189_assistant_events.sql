-- Assistant usage events (Quinn Copilot outcome loop): append-only, one row
-- per teammate interaction with an AI surface — an answer/note/transform/
-- summary inserted into the composer, or a thumbs up/down on an answer.
-- event_type is open text (no CHECK) so new surfaces add event kinds without
-- a migration; readers filter on the types they understand.
CREATE TABLE "assistant_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"principal_id" uuid,
	"conversation_id" uuid,
	"ticket_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_events"
	ADD CONSTRAINT "assistant_events_principal_id_principal_id_fk"
	FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_events"
	ADD CONSTRAINT "assistant_events_conversation_id_conversations_id_fk"
	FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_events"
	ADD CONSTRAINT "assistant_events_ticket_id_tickets_id_fk"
	FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Drives the Copilot usage report's per-type date-range scan; the retention
-- sweep runs unindexed (daily, 180-day-capped, low volume).
CREATE INDEX "assistant_events_event_type_created_at_idx"
	ON "assistant_events" USING btree ("event_type","created_at");
