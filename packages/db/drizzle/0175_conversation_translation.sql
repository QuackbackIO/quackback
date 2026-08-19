-- Two-way inbox translation (P2-D.1). Per-conversation activation state plus
-- the detected customer language live on the conversation row as plain
-- columns, mirroring how other per-conversation UI state (priority,
-- snoozed_until, assigned_team_id) is stored rather than a bundled jsonb
-- blob. `translation_dismissed_at` suppresses the auto-suggest banner once a
-- teammate dismisses it; `translation_enabled` is the manual activation
-- toggle; `detected_customer_language` is a best-effort, once-computed cache
-- of the visitor's language (see conversation-translation.service.ts).
ALTER TABLE "conversations" ADD COLUMN "detected_customer_language" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "translation_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "translation_dismissed_at" timestamp with time zone;
--> statement-breakpoint
-- Per-(message, locale) translation cache for the INCOMING direction, mirroring
-- kb_article_translations' (parentId, locale) -> content shape.
-- conversation_messages.content/content_json are NEVER mutated by a display
-- translation. The OUTGOING direction doesn't use this table -- see the
-- schema.ts comment on conversationMessageTranslations for why.
CREATE TABLE "conversation_message_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_message_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message_translations" ADD CONSTRAINT "conversation_message_translations_message_id_fkey" FOREIGN KEY ("conversation_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_translations_unique_idx" ON "conversation_message_translations" USING btree ("conversation_message_id","locale");
--> statement-breakpoint
-- Backs the 180-day retention sweep for conversation_message_translations
-- (cleanupExpiredMessageTranslations, conversation-translation.service.ts),
-- mirroring assistant_tool_calls_created_at_idx's plain created_at index for
-- the same DELETE ... WHERE created_at < cutoff shape.
CREATE INDEX "conversation_message_translations_created_at_idx" ON "conversation_message_translations" USING btree ("created_at");
