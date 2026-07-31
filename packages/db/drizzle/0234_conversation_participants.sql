-- Conversation participants: the customers beyond the primary visitor an agent
-- has added to a conversation (§4.8 group threads). A participant receives
-- every subsequent agent reply by email (fan-out in conversation.notify). Both
-- FKs cascade so deleting a conversation or a principal cleans up here; the
-- adding teammate is kept for attribution but goes NULL if that principal is
-- removed, never blocking teardown.
-- FK names match the drizzle schema declaration (the drift checker diffs them).

CREATE TABLE "conversation_participants" (
  "conversation_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "added_by_principal_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "conversation_participants_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE CASCADE,
  CONSTRAINT "conversation_participants_added_by_fkey" FOREIGN KEY ("added_by_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "conversation_participants_pk"
  ON "conversation_participants" ("conversation_id", "principal_id");

CREATE INDEX "conversation_participants_conversation_id_idx"
  ON "conversation_participants" ("conversation_id");

CREATE INDEX "conversation_participants_principal_id_idx"
  ON "conversation_participants" ("principal_id");
