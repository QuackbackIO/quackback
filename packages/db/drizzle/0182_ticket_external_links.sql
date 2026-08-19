-- Ticket <-> external issue links: a sibling of post_external_links (a
-- deliberately separate table — post_external_links.post_id is NOT NULL and
-- its consumers assume post-only). Created when a teammate links a ticket to
-- an existing tracker issue; the (integration_type, external_id) index serves
-- the inbound-webhook reverse lookup that maps issue state changes onto
-- ticket statuses.
CREATE TABLE "ticket_external_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"integration_id" uuid,
	"integration_type" varchar(50) NOT NULL,
	"external_id" text NOT NULL,
	"external_display_id" text,
	"external_url" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_external_links_type_external_ticket_unique" UNIQUE("external_id","integration_type","ticket_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_external_links" ADD CONSTRAINT "ticket_external_links_ticket_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_external_links" ADD CONSTRAINT "ticket_external_links_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_external_links_ticket_id_idx" ON "ticket_external_links" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_external_links_type_external_id_idx" ON "ticket_external_links" USING btree ("integration_type","external_id");--> statement-breakpoint
CREATE INDEX "ticket_external_links_ticket_status_idx" ON "ticket_external_links" USING btree ("ticket_id","status");
