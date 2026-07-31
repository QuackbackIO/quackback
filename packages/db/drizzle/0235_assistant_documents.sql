-- Admin-uploaded knowledge documents (PDFs) for Quinn grounding. The
-- extracted text in `content` is what retrieval grounds on; `storage_key`
-- keeps the original bytes in object storage when S3 is configured. Documents
-- are admin-curated customer-answerable content, so there is no draft or
-- audience state: every non-deleted row is retrievable at every ceiling.
-- TypeIDs are stored as native `uuid` (prefixes are a code-only concern).
CREATE TABLE IF NOT EXISTS "assistant_documents" (
  "id" uuid PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "storage_key" text,
  "content" text NOT NULL,
  "embedding" vector(1536),
  "embedding_model" text,
  "embedding_updated_at" timestamp with time zone,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "assistant_documents_title_length_check" CHECK (char_length("title") <= 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_documents_embedding_hnsw_idx" ON "assistant_documents" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assistant_documents" ADD CONSTRAINT "assistant_documents_created_by_id_principal_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
