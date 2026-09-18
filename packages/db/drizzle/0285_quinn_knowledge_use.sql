-- Expand-only. Apply before deploying source-use-aware readers.
ALTER TABLE "kb_articles" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "kb_articles" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "assistant_documents" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "assistant_documents" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "assistant_snippets" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "assistant_snippets" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "assistant_web_sources" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "assistant_web_sources" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "ticket_summaries" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "ticket_summaries" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "conversation_summaries" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "assistant_customer_use" boolean NOT NULL DEFAULT true;
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "assistant_team_use" boolean NOT NULL DEFAULT true;

--> statement-breakpoint
ALTER TABLE settings ALTER COLUMN assistant_config SET DEFAULT '{"version":4,"identity":{"name":"Quinn","avatarUrl":null},"agents":{"workspace":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"webPages":true,"documents":true,"status":true},"toolRules":{},"instructions":"","slack":{"enabled":false,"respondTo":"mentions_and_dms","allowUnlinkedPublicQa":false}},"agent":{"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"knowledge":{"helpCenter":true,"posts":false,"changelog":false,"webPages":true,"documents":true,"status":false},"toolRules":{}},"copilot":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"webPages":true,"documents":true,"status":true},"toolRules":{}}}}'::jsonb;
