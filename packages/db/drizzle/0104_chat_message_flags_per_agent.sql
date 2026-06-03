-- Make message flags PER-AGENT ("Saved for later"): each agent flags messages
-- independently, instead of one shared team-wide flag. Recreate the table with a
-- composite (message, principal) primary key. The flag feature is new this
-- release, so dropping the old single-PK shape loses no meaningful data.
DROP TABLE IF EXISTS "chat_message_flags";

CREATE TABLE "chat_message_flags" (
  "chat_message_id" uuid NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "principal_id" uuid NOT NULL REFERENCES "principal"("id") ON DELETE CASCADE,
  "flagged_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("chat_message_id", "principal_id")
);

-- Serves the per-agent "Saved for later" feed: one agent's flags, newest first.
CREATE INDEX "chat_message_flags_principal_idx"
  ON "chat_message_flags" ("principal_id", "flagged_at" DESC);
