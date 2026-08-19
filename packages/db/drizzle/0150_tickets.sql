-- Tickets (support platform §4.2): the durable, trackable support object, a peer
-- to conversations rather than a wrapper. Conversations carry the thread; tickets
-- carry tracked work (status, assignee, SLA timestamps) and link to conversations
-- through ticket_conversations. Three kinds share one table via `type`: a
-- customer ticket (customer-visible, at most one per conversation), a back_office
-- ticket (internal task), and a tracker (umbrella that fans work out to linked
-- tickets via ticket_links). Default statuses are seeded by seed-system, not here.
CREATE TABLE "ticket_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"category" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"public_stage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ticket_statuses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
-- Status board ordering within a category, and the soft-delete filter.
CREATE INDEX "ticket_statuses_position_idx" ON "ticket_statuses" ("category", "position");
--> statement-breakpoint
CREATE INDEX "ticket_statuses_deleted_at_idx" ON "ticket_statuses" ("deleted_at");
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigserial NOT NULL,
	"type" text DEFAULT 'customer' NOT NULL,
	"title" text NOT NULL,
	"status_id" uuid NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"requester_principal_id" uuid,
	"assignee_principal_id" uuid,
	"assignee_team_id" uuid,
	"company_id" uuid,
	"custom_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_response_at" timestamp with time zone,
	"waiting_since" timestamp with time zone,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
-- restrict: a status in use can never be deleted out from under its tickets.
ALTER TABLE "tickets"
	ADD CONSTRAINT "tickets_status_id_fkey"
	FOREIGN KEY ("status_id") REFERENCES "ticket_statuses"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "tickets"
	ADD CONSTRAINT "tickets_requester_principal_id_fkey"
	FOREIGN KEY ("requester_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "tickets"
	ADD CONSTRAINT "tickets_assignee_principal_id_fkey"
	FOREIGN KEY ("assignee_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "tickets"
	ADD CONSTRAINT "tickets_assignee_team_id_fkey"
	FOREIGN KEY ("assignee_team_id") REFERENCES "teams"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "tickets"
	ADD CONSTRAINT "tickets_company_id_fkey"
	FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE set null;
--> statement-breakpoint
-- Ticket #N lookups + the sequence guarantee (bigserial alone is not unique).
CREATE UNIQUE INDEX "tickets_number_uq" ON "tickets" ("number");
--> statement-breakpoint
CREATE INDEX "tickets_status_id_idx" ON "tickets" ("status_id");
--> statement-breakpoint
CREATE INDEX "tickets_assignee_principal_id_idx" ON "tickets" ("assignee_principal_id");
--> statement-breakpoint
CREATE INDEX "tickets_requester_principal_id_idx" ON "tickets" ("requester_principal_id");
--> statement-breakpoint
CREATE INDEX "tickets_company_id_idx" ON "tickets" ("company_id");
--> statement-breakpoint
-- Type-scoped status boards (e.g. all open customer tickets).
CREATE INDEX "tickets_type_status_id_idx" ON "tickets" ("type", "status_id");
--> statement-breakpoint
-- Soft link between a ticket and a conversation: a join, not an FK on either
-- table, so a conversation can back several tickets and vice versa. ticket_type
-- is denormalized from tickets.type at link time so the customer-uniqueness rule
-- is a partial index here without a join. Both sides cascade.
CREATE TABLE "ticket_conversations" (
	"ticket_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"ticket_type" text NOT NULL,
	"linked_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_conversations_pkey" PRIMARY KEY ("ticket_id", "conversation_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_conversations"
	ADD CONSTRAINT "ticket_conversations_ticket_id_fkey"
	FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ticket_conversations"
	ADD CONSTRAINT "ticket_conversations_conversation_id_fkey"
	FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ticket_conversations"
	ADD CONSTRAINT "ticket_conversations_linked_by_principal_id_fkey"
	FOREIGN KEY ("linked_by_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- Conversation -> tickets reverse lookup (the PK leads with ticket_id).
CREATE INDEX "ticket_conversations_conversation_idx" ON "ticket_conversations" ("conversation_id");
--> statement-breakpoint
-- At most one CUSTOMER ticket per conversation. Partial so back-office and
-- tracker links never collide.
CREATE UNIQUE INDEX "ticket_conversations_customer_uq" ON "ticket_conversations" ("conversation_id") WHERE ticket_type = 'customer';
--> statement-breakpoint
-- Tracker cascade: a tracker ticket points at the tickets it fans work out to.
-- relation defaults to 'tracks'; both sides cascade to tickets.
CREATE TABLE "ticket_links" (
	"tracker_ticket_id" uuid NOT NULL,
	"linked_ticket_id" uuid NOT NULL,
	"relation" text DEFAULT 'tracks' NOT NULL,
	"linked_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("tracker_ticket_id", "linked_ticket_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_links"
	ADD CONSTRAINT "ticket_links_tracker_ticket_id_fkey"
	FOREIGN KEY ("tracker_ticket_id") REFERENCES "tickets"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ticket_links"
	ADD CONSTRAINT "ticket_links_linked_ticket_id_fkey"
	FOREIGN KEY ("linked_ticket_id") REFERENCES "tickets"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ticket_links"
	ADD CONSTRAINT "ticket_links_linked_by_principal_id_fkey"
	FOREIGN KEY ("linked_by_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- Tracker -> linked reverse lookup (the PK leads with tracker_ticket_id).
CREATE INDEX "ticket_links_linked_ticket_idx" ON "ticket_links" ("linked_ticket_id");
--> statement-breakpoint
-- A linked ticket is tracked by at most one tracker (partial: 'tracks' only).
CREATE UNIQUE INDEX "ticket_links_tracks_uq" ON "ticket_links" ("linked_ticket_id") WHERE relation = 'tracks';
