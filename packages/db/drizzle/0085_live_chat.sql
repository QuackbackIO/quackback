-- Live chat: visitor <-> support-team conversations and their messages.
--
-- Scoped to the tenant by the database connection (database-per-tenant); no
-- workspace column. Modeled on the comments table.
--
-- conversations.visitor_principal_id and chat_messages.principal_id use
-- ON DELETE RESTRICT so a principal that owns chat history can never be
-- silently orphaned. The anonymous->identified merge (merge-anonymous.ts)
-- re-points both columns before deleting the anonymous principal.

CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY,
  "visitor_principal_id" uuid NOT NULL REFERENCES "principal"("id") ON DELETE RESTRICT,
  "assigned_agent_principal_id" uuid REFERENCES "principal"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'open',
  "subject" text,
  "last_message_preview" text,
  "last_message_at" timestamptz NOT NULL DEFAULT now(),
  "visitor_last_read_at" timestamptz,
  "agent_last_read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz
);

CREATE INDEX "conversations_status_last_message_idx"
  ON "conversations" ("status", "last_message_at");

CREATE INDEX "conversations_visitor_principal_idx"
  ON "conversations" ("visitor_principal_id");

CREATE INDEX "conversations_assigned_agent_idx"
  ON "conversations" ("assigned_agent_principal_id");

CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  -- Nullable: system events (e.g. assignment notices) have no human author.
  "principal_id" uuid REFERENCES "principal"("id") ON DELETE RESTRICT,
  "sender_type" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "deleted_at" timestamptz,
  "deleted_by_principal_id" uuid REFERENCES "principal"("id") ON DELETE SET NULL
);

CREATE INDEX "chat_messages_conversation_created_idx"
  ON "chat_messages" ("conversation_id", "created_at", "id");

CREATE INDEX "chat_messages_principal_idx"
  ON "chat_messages" ("principal_id");

CREATE INDEX "chat_messages_created_at_idx"
  ON "chat_messages" ("created_at");
