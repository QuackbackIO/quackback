-- Drift repair. The audit-remediation commit (schema-only) declared several
-- indexes in src/schema without a matching migration, so fresh installs never
-- built them. This migration adds exactly that missing DDL so the hand-written
-- SQL and the TS schema describe the same database again. Every statement is
-- idempotent because long-lived dev databases may already carry some of these
-- indexes from other code paths.

-- 1. Vector-search HNSW indexes declared in TS but never migrated. Partial on
--    the embedding column, mirroring the two that migration 0203 already owns.
CREATE INDEX IF NOT EXISTS "posts_embedding_hnsw_idx" ON "posts" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_articles_embedding_hnsw_idx" ON "kb_articles" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_signals_embedding_hnsw_idx" ON "feedback_signals" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_suggestions_embedding_hnsw_idx" ON "feedback_suggestions" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_snippets_embedding_hnsw_idx" ON "assistant_snippets" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_summaries_embedding_hnsw_idx" ON "conversation_summaries" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint

-- 2. page_views principal_id partial index declared in TS but never migrated.
CREATE INDEX IF NOT EXISTS "page_views_principal_id_idx" ON "page_views" ("principal_id") WHERE "principal_id" IS NOT NULL;--> statement-breakpoint

-- 3. Trgm search indexes: the audit remediation narrowed them to partial (skip
--    null display_name / soft-deleted messages). Migration 0139 created them
--    unqualified, so drop and re-create to match the TS declaration exactly.
DROP INDEX IF EXISTS "principal_display_name_trgm_idx";--> statement-breakpoint
CREATE INDEX "principal_display_name_trgm_idx" ON "principal" USING gin ("display_name" gin_trgm_ops) WHERE "display_name" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_messages_content_trgm_idx";--> statement-breakpoint
CREATE INDEX "conversation_messages_content_trgm_idx" ON "conversation_messages" USING gin ("content" gin_trgm_ops) WHERE "deleted_at" IS NULL;
