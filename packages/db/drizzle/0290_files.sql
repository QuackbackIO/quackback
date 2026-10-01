-- @contract: additive
-- Uploaded files attached to conversation and ticket messages. A row is written
-- when an upload finishes, before the message exists; message_id is set when it
-- is sent, and the retention sweep removes files that never were. content_type,
-- family and size are read from the stored bytes, not the sender's claim.
CREATE TABLE IF NOT EXISTS "files" (
  "id" uuid PRIMARY KEY NOT NULL,
  "storage_key" text NOT NULL,
  "name" text NOT NULL,
  "content_type" text NOT NULL,
  "declared_type" text,
  "family" text NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text NOT NULL,
  "source" text NOT NULL,
  "uploaded_by_id" uuid REFERENCES "principal"("id") ON DELETE SET NULL,
  "message_id" uuid REFERENCES "conversation_messages"("id") ON DELETE SET NULL,
  "attached_at" timestamptz,
  "preview_status" text NOT NULL DEFAULT 'pending',
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "text_excerpt" text,
  "open_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "files_storage_key_idx" ON "files" ("storage_key");
CREATE INDEX IF NOT EXISTS "files_message_id_idx" ON "files" ("message_id");
CREATE INDEX IF NOT EXISTS "files_unattached_created_at_idx" ON "files" ("created_at") WHERE "attached_at" IS NULL AND "deleted_at" IS NULL;
