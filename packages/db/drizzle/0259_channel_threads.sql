-- @contract: safe-after 0.13.2
-- Channels Phase 3: channel_accounts is no longer email-only, connection
-- accounts can reference an integration, and channel_threads is the shared
-- inbound correlation table. The email-only CHECK is dropped so a later
-- channel can store rows without a second migration; existing rows stay email.
ALTER TABLE "channel_accounts" DROP CONSTRAINT IF EXISTS "channel_accounts_channel_check";
--> statement-breakpoint
ALTER TABLE "channel_accounts" DROP CONSTRAINT IF EXISTS "channel_accounts_role_check";
--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_role_check" CHECK ("role" IN ('inbound','sending','connection'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_threads" (
  "id" uuid PRIMARY KEY NOT NULL,
  "channel_account_id" uuid NOT NULL,
  "external_thread_key" text NOT NULL,
  "conversation_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_threads_account_key_uq"
  ON "channel_threads" ("channel_account_id", "external_thread_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_threads_conversation_idx"
  ON "channel_threads" ("conversation_id");
--> statement-breakpoint
-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname =
-- 'channel_threads_channel_account_id_fkey'; the block's only action is adding
-- that constraint, so a second run does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_threads_channel_account_id_fkey'
  ) THEN
    ALTER TABLE "channel_threads"
      ADD CONSTRAINT "channel_threads_channel_account_id_fkey"
      FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE CASCADE;
  END IF;
END $$;
