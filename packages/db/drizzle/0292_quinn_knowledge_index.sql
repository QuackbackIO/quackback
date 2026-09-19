-- @contract: additive
-- Derived passage index over the existing knowledge sources (QUINN-PRODUCT
-- Step 9, P5).
--
-- A search projection, not a second copy of the corpus. Every read joins back
-- to the help-center article, uploaded document or web page it projects, so a
-- category turning private, an article being unpublished or a document being
-- soft-deleted removes its passages from retrieval immediately, with no
-- reindex and no copied audience tag that could go stale.
--
-- Expand-only and replay-safe: three CREATE TABLE IF NOT EXISTS with every
-- constraint declared INLINE (a bare ALTER TABLE ... ADD CONSTRAINT errors on a
-- second run and breaks the ledger heal), and CREATE [UNIQUE] INDEX IF NOT
-- EXISTS for the rest. Nothing existing is read differently and nothing is
-- dropped.
--
-- No backfill, deliberately. Building a generation means extracting, chunking
-- and embedding, which is not something a statement can do and not something a
-- replayed statement may do twice. Existing sources are indexed lazily through
-- the 'assistant-knowledge-index' queue's bounded, resumable backfill, and
-- until a source has an active generation its existing whole-source adapter
-- keeps answering, so retrieval never has a gap while the backfill runs.
--
-- Foreign keys are named explicitly. Drizzle's derived name for, say,
-- assistant_chunks.knowledge_source_id -> assistant_knowledge_sources.id is
-- longer than PostgreSQL's 63-character identifier limit and comes back
-- truncated, which the drift check reads as drift.
--
-- assistant_knowledge_sources.active_version_id carries NO foreign key on
-- purpose: the two tables reference each other and a circular inline
-- constraint cannot be expressed in a file that creates them in order.
-- Activation flips the version row and this column in one transaction, so the
-- pair cannot disagree.

CREATE TABLE IF NOT EXISTS "assistant_knowledge_sources" (
  "id" uuid PRIMARY KEY NOT NULL,
  -- article, document or webpage: the canonical citation source type, so a
  -- passage maps back to the existing citation contract server-side.
  "source_type" text NOT NULL,
  -- The source row's own primary key. A uuid rather than the application's
  -- prefixed id string, so the retrieval join is an indexed uuid comparison
  -- against whichever of the three source tables this row projects.
  "source_id" uuid NOT NULL,
  "active_version_id" uuid,
  -- Durable revision of the content the last index request observed.
  "source_revision" text,
  "indexing_status" text DEFAULT 'pending' NOT NULL,
  -- Monotonic, so a retried run never reuses a generation number.
  "generation_counter" integer DEFAULT 0 NOT NULL,
  "last_failure_reason" text,
  "last_indexed_at" timestamp with time zone,
  "tombstoned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_knowledge_sources_type_check" CHECK ("source_type" IN ('article', 'document', 'webpage')),
  CONSTRAINT "assistant_knowledge_sources_status_check" CHECK ("indexing_status" IN ('pending', 'indexing', 'indexed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_knowledge_sources_identity_uidx" ON "assistant_knowledge_sources" ("source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_knowledge_sources_status_idx" ON "assistant_knowledge_sources" ("indexing_status", "updated_at");
--> statement-breakpoint
-- One generation of one source. Staged first, activated last: a refresh that
-- fails part way leaves the previous complete generation active and this row
-- failed, which is what makes the failure inspectable instead of a gap.
CREATE TABLE IF NOT EXISTS "assistant_source_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "knowledge_source_id" uuid NOT NULL,
  "generation" integer NOT NULL,
  "content_hash" text NOT NULL,
  "parser_version" text NOT NULL,
  "chunker_version" text NOT NULL,
  -- Null means this generation carries no vectors at all. Equal dimensions do
  -- not imply a compatible space, so the model is recorded per generation and
  -- the vector arm skips any generation a different model embedded.
  "embedding_model" text,
  "embedding_dimensions" integer,
  "status" text DEFAULT 'staging' NOT NULL,
  "degraded_reason" text,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "embedded_chunk_count" integer DEFAULT 0 NOT NULL,
  "source_updated_at" timestamp with time zone,
  "failure_reason" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "assistant_source_versions_status_check" CHECK ("status" IN ('staging', 'active', 'superseded', 'failed')),
  CONSTRAINT "assistant_source_versions_source_fk" FOREIGN KEY ("knowledge_source_id") REFERENCES "assistant_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_source_versions_generation_uidx" ON "assistant_source_versions" ("knowledge_source_id", "generation");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_source_versions_status_idx" ON "assistant_source_versions" ("knowledge_source_id", "status");
--> statement-breakpoint
-- One passage. Both the unit that matches and the unit handed to the model,
-- which is the whole point: a fact past character 8,000 of its source is
-- reachable because it has its own row, its own lexical vector and its own
-- embedding.
CREATE TABLE IF NOT EXISTS "assistant_chunks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "version_id" uuid NOT NULL,
  "knowledge_source_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "heading_path" text,
  "char_start" integer NOT NULL,
  "char_end" integer NOT NULL,
  "content" text NOT NULL,
  "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("heading_path", '')), 'A') || setweight(to_tsvector('english', "content"), 'B')) STORED,
  "embedding" vector(1536),
  "embedding_model" text,
  "chunk_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_chunks_offsets_check" CHECK ("char_end" >= "char_start"),
  CONSTRAINT "assistant_chunks_version_fk" FOREIGN KEY ("version_id") REFERENCES "assistant_source_versions"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "assistant_chunks_source_fk" FOREIGN KEY ("knowledge_source_id") REFERENCES "assistant_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_chunks_ordinal_uidx" ON "assistant_chunks" ("version_id", "ordinal");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_chunks_search_vector_idx" ON "assistant_chunks" USING gin ("search_vector");
--> statement-breakpoint
-- Approximate nearest neighbour over the vector arm. Exact search stays the
-- correctness baseline: the filters, the source-permission joins and the
-- active-generation join all run as ordinary predicates around it.
CREATE INDEX IF NOT EXISTS "assistant_chunks_embedding_hnsw_idx" ON "assistant_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
