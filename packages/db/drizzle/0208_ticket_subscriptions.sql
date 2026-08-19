-- Ticket subscriptions ("watchers"): one row per (ticket, principal) with a
-- provenance reason and a temporary mute. Unsubscribe deletes the row; a new
-- qualifying interaction (assignment, agent reply) re-subscribes. muted_until
-- in the future suppresses watcher notifications; NULL or past = active.
CREATE TABLE "ticket_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"reason" varchar(20) NOT NULL,
	"muted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_subscriptions"
	ADD CONSTRAINT "ticket_subscriptions_ticket_id_fkey"
	FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ticket_subscriptions"
	ADD CONSTRAINT "ticket_subscriptions_principal_id_fkey"
	FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_subscriptions_unique" ON "ticket_subscriptions" ("ticket_id","principal_id");
--> statement-breakpoint
CREATE INDEX "ticket_subscriptions_ticket_idx" ON "ticket_subscriptions" ("ticket_id");
--> statement-breakpoint
CREATE INDEX "ticket_subscriptions_principal_idx" ON "ticket_subscriptions" ("principal_id");
