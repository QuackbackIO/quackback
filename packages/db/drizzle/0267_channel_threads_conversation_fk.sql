-- @contract: safe-after 0.13.2
-- Spam hard-delete must free the (account, external_thread_key) unique slot
-- the same way conversation_outbound_emails does.
-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname =
-- 'channel_threads_conversation_id_fkey'; the block's only action is adding that
-- constraint, so a second run does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_threads_conversation_id_fkey'
  ) THEN
    ALTER TABLE "channel_threads"
      ADD CONSTRAINT "channel_threads_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
  END IF;
END $$;
