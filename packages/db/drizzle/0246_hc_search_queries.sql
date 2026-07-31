-- Append-only log of visitor help-center searches (portal /hc box + widget).
-- normalized_query is the grouping key for admin search-term analytics;
-- rows carry no principal reference because visitors are usually anonymous.
CREATE TABLE IF NOT EXISTS "kb_search_queries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "query" text NOT NULL,
  "normalized_query" text NOT NULL,
  "locale" text NOT NULL,
  "results_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_search_queries_created_at_idx" ON "kb_search_queries" ("created_at");
