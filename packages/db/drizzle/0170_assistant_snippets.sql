-- Assistant snippets: short, private facts an admin curates for Quinn to
-- ground answers on, alongside the knowledge base and (when the
-- assistantSnippets flag is on) feedback posts. `audience` mirrors the
-- assistant's ContentAudience retrieval ceiling (public/team/internal);
-- embeddings are generated synchronously at write time (snippet.service.ts).
-- No vector index (matches house style for this corpus size).
CREATE TABLE "assistant_snippets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"audience" text DEFAULT 'team' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_updated_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_snippets"
	ADD CONSTRAINT "assistant_snippets_created_by_id_principal_id_fk"
	FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_snippets"
	ADD CONSTRAINT "assistant_snippets_title_length_check" CHECK (char_length("title") <= 120);
--> statement-breakpoint
ALTER TABLE "assistant_snippets"
	ADD CONSTRAINT "assistant_snippets_content_length_check" CHECK (char_length("content") <= 2000);
--> statement-breakpoint
ALTER TABLE "assistant_snippets"
	ADD CONSTRAINT "assistant_snippets_audience_check" CHECK ("audience" IN ('public','team','internal'));
--> statement-breakpoint
CREATE INDEX "assistant_snippets_enabled_audience_idx" ON "assistant_snippets" USING btree ("enabled","audience");
