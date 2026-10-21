-- @contract: additive
-- Ticket replies mirrored as comments on linked issues: one row per reply and
-- linked issue (ticket_external_links), naming the comment that stands for it.
-- An outbound row is a comment the connection posted, so an edit, a file
-- change or a deletion of the reply follows onto that comment; inbound rows
-- will record comments brought in from the issue. Kept apart from
-- conversation_messages.metadata, which the inbox reads as a channel thread's
-- comment. A new table with no backfill (nothing was mirrored before), so
-- older app versions never read it. Replay-safe: every statement is
-- IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "message_external_links" (
  "id" uuid PRIMARY KEY NOT NULL,
  "message_id" uuid NOT NULL,
  "ticket_external_link_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "sync_scope" text NOT NULL,
  "external_id" text NOT NULL,
  "external_url" text,
  "direction" text DEFAULT 'outbound' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "remote_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- cascade: a reply removed for good takes its record with it.
  CONSTRAINT "message_external_links_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE cascade,
  -- cascade: an unlinked issue's comments are no longer followed.
  CONSTRAINT "message_external_links_ticket_external_link_id_fkey" FOREIGN KEY ("ticket_external_link_id") REFERENCES "ticket_external_links"("id") ON DELETE cascade,
  -- cascade: nothing is followed without the connection that posted it.
  CONSTRAINT "message_external_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE cascade
);
--> statement-breakpoint
-- One comment per reply and linked issue.
CREATE UNIQUE INDEX IF NOT EXISTS "message_external_links_link_message_uq" ON "message_external_links" USING btree ("ticket_external_link_id", "message_id");
--> statement-breakpoint
-- A comment stands for one message per linked issue (comment ids are unique
-- on the provider, so a posted comment stands for one reply).
CREATE UNIQUE INDEX IF NOT EXISTS "message_external_links_link_external_uq" ON "message_external_links" USING btree ("ticket_external_link_id", "external_id");
--> statement-breakpoint
-- A reply's comments, found when it is edited or deleted (and on its removal).
CREATE INDEX IF NOT EXISTS "message_external_links_message_idx" ON "message_external_links" USING btree ("message_id");
