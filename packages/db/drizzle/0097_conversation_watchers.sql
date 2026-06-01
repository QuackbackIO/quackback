-- Conversation watchers: team members who follow a conversation and get
-- notified of new visitor messages even when not the assignee. Both FKs cascade
-- so deleting a conversation or a principal removes the watch. Additive (new
-- table); existing data unaffected.

CREATE TABLE IF NOT EXISTS "conversation_watchers" (
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "principal_id" uuid NOT NULL REFERENCES "principal"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_watchers_pk"
  ON "conversation_watchers" ("conversation_id", "principal_id");
CREATE INDEX IF NOT EXISTS "conversation_watchers_conversation_id_idx"
  ON "conversation_watchers" ("conversation_id");
CREATE INDEX IF NOT EXISTS "conversation_watchers_principal_id_idx"
  ON "conversation_watchers" ("principal_id");
