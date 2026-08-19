-- Conversation summaries: one AI-generated summary per closed conversation
-- (Quinn P2-A.4), produced by conversation-summary.service.ts on close from
-- the customer-visible transcript (assistant.thread.ts already excludes
-- internal notes) and embedded for semantic retrieval. Quinn grounds only on
-- a customer's OWN past summaries (conversation-summary-retrieval.ts) —
-- `visitor_principal_id` is denormalized from the parent conversation so
-- that mandatory scoping predicate never needs a join back to it.
-- No vector index (matches house style for this corpus size).
CREATE TABLE "conversation_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"visitor_principal_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summaries_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_summaries"
	ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk"
	FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_summaries"
	ADD CONSTRAINT "conversation_summaries_visitor_principal_id_principal_id_fk"
	FOREIGN KEY ("visitor_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversation_summaries_visitor_principal_id_idx" ON "conversation_summaries" USING btree ("visitor_principal_id");
