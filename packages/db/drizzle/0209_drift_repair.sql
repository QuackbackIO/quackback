-- Drift repair. The audit-remediation commit (schema-only) declared several
-- indexes in src/schema without a matching migration, so fresh installs never
-- built them. This migration adds exactly that missing DDL so the hand-written
-- SQL and the TS schema describe the same database again. Every statement is
-- idempotent because long-lived dev databases may already carry some of these
-- indexes from other code paths.

-- 1. Vector-search HNSW indexes declared in TS but never migrated, partial on
--    the embedding column: posts_embedding_hnsw_idx,
--    kb_articles_embedding_hnsw_idx, assistant_snippets_embedding_hnsw_idx and
--    conversation_summaries_embedding_hnsw_idx. They are not built here: an
--    HNSW build over an existing table is slow and memory hungry, and inside
--    the migration transaction it would hold its lock for the whole upgrade.
--    They are built CONCURRENTLY after the migrations commit, from
--    CONCURRENT_INDEX_SPECS in packages/db/src/schema-ops.ts.

-- 2. page_views principal_id partial index declared in TS but never migrated.
CREATE INDEX IF NOT EXISTS "page_views_principal_id_idx" ON "page_views" ("principal_id") WHERE "principal_id" IS NOT NULL;--> statement-breakpoint

-- 3. Trgm search indexes: the audit remediation narrowed them to partial (skip
--    null display_name / soft-deleted messages). A database that carries an
--    unqualified copy drops it here, so the concurrent build (see 1) creates
--    the partial one in its place. A partial copy is left alone.
-- @replay: guarded-by the index having no partial predicate; once the partial index exists the drop is skipped
DO $$
DECLARE
	idx text;
BEGIN
	FOREACH idx IN ARRAY ARRAY['principal_display_name_trgm_idx', 'conversation_messages_content_trgm_idx'] LOOP
		IF EXISTS (
			SELECT 1 FROM pg_index i
			WHERE i.indexrelid = to_regclass(quote_ident(idx))
				AND i.indpred IS NULL
		) THEN
			EXECUTE format('DROP INDEX %I', idx);
		END IF;
	END LOOP;
END $$;
