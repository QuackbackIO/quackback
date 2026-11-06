-- @contract: additive
-- Workspace search reads every kind from an index. These are the kinds that
-- had none: a ticket's title, a conversation's subject and a changelog entry's
-- text (each expression is the one the queries use, so the planner matches
-- it), and the email, company name and domain matched anywhere inside.
CREATE INDEX IF NOT EXISTS "tickets_title_search_idx" ON "tickets" USING gin (to_tsvector('english', "title"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_subject_search_idx" ON "conversations" USING gin (to_tsvector('english', coalesce("subject", '')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_entries_search_idx" ON "changelog_entries" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", '')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_email_trgm_idx" ON "user" USING gin ("email" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_name_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_domain_trgm_idx" ON "companies" USING gin ("domain" gin_trgm_ops);
--> statement-breakpoint
-- A title that contains the query anywhere inside is a candidate too (so
-- "fund" finds "Refund policy"), matched with ILIKE '%query%'. posts.title is
-- already served by posts_title_trgm_idx; these cover the other titles.
CREATE INDEX IF NOT EXISTS "kb_articles_title_trgm_idx" ON "kb_articles" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_entries_title_trgm_idx" ON "changelog_entries" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_title_trgm_idx" ON "tickets" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_subject_trgm_idx" ON "conversations" USING gin ("subject" gin_trgm_ops);
