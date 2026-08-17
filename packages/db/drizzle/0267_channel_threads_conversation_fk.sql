-- @contract: safe-after 0.13.2
-- Spam hard-delete must free the (account, external_thread_key) unique slot
-- the same way conversation_outbound_emails does.
ALTER TABLE "channel_threads"
  ADD CONSTRAINT "channel_threads_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
