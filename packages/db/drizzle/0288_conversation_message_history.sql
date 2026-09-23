-- Edit history and redaction for support messages. An edit keeps the body it
-- replaced in conversation_message_edits so the team can still see it; a delete
-- only hides a message. A moderator redaction wipes the body, attachments, and
-- that history for good, and records who did it on the message row.
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "redacted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "redacted_by_principal_id" uuid CONSTRAINT "conversation_messages_redacted_by_principal_id_fkey" REFERENCES "principal"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_message_edits" (
  "id" uuid PRIMARY KEY NOT NULL,
  "message_id" uuid NOT NULL CONSTRAINT "conversation_message_edits_message_id_fkey" REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "editor_principal_id" uuid CONSTRAINT "conversation_message_edits_editor_principal_id_fkey" REFERENCES "principal"("id") ON DELETE SET NULL,
  "previous_content" text NOT NULL,
  "previous_content_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_message_edits_message_idx" ON "conversation_message_edits" ("message_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_message_edits_editor_idx" ON "conversation_message_edits" ("editor_principal_id");
