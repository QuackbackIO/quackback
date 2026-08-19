-- Quinn Phase 4: two new grounding sources — closed-ticket resolution
-- summaries and changelog entries.
--
-- 1. ticket_summaries: one AI resolution summary per closed ticket, produced
--    by ticket-summary.service.ts on close from the ticket's customer-visible
--    thread and embedded for semantic retrieval (tickets-retrieval.ts).
--    Team-only knowledge — never customer-scoped at retrieval — so unlike
--    conversation_summaries the requester principal is provenance only, not a
--    scoping predicate. HNSW cosine index over the embedding.
CREATE TABLE "ticket_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"requester_principal_id" uuid,
	"summary" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_summaries_ticket_id_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_summaries"
	ADD CONSTRAINT "ticket_summaries_ticket_id_tickets_id_fk"
	FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_summaries"
	ADD CONSTRAINT "ticket_summaries_requester_principal_id_principal_id_fk"
	FOREIGN KEY ("requester_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_summaries_requester_principal_id_idx" ON "ticket_summaries" USING btree ("requester_principal_id");
--> statement-breakpoint
CREATE INDEX "ticket_summaries_embedding_hnsw_idx" ON "ticket_summaries" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
--> statement-breakpoint
-- 2. changelog_entries: embedding column trio + HNSW cosine index. Published
--    entries are embedded on publish/edit (changelog-embedding.service.ts);
--    drafts stay null until next published. Existing rows embed lazily on
--    their next edit/publish — no backfill job.
ALTER TABLE "changelog_entries" ADD COLUMN "embedding" vector(1536);
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "embedding_model" text;
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "embedding_updated_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "changelog_embedding_hnsw_idx" ON "changelog_entries" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
