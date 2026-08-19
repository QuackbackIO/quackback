-- Make conversation_messages polymorphic: a message hangs off a conversation OR
-- a ticket (support platform §4.2). The exactly-one CHECK holds from day one, so
-- no message is ever parentless or double-parented. Existing rows all carry a
-- conversation_id and no ticket_id, so they satisfy the CHECK unchanged.
--
-- The same migration adds the generated search_vector (FTS over message content):
-- free while the table is being rewritten for the new column, and it backs both
-- ticket search and the inbox FTS upgrade.
ALTER TABLE "conversation_messages" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_parent_check" CHECK (num_nonnulls("conversation_id", "ticket_id") = 1);--> statement-breakpoint
CREATE INDEX "conversation_messages_ticket_created_idx" ON "conversation_messages" ("ticket_id","created_at","id");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;--> statement-breakpoint
CREATE INDEX "conversation_messages_search_vector_idx" ON "conversation_messages" USING gin ("search_vector");
