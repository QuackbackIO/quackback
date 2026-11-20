-- @contract: additive
-- The address a conversation's customer email first went out from. Every later
-- email on the thread sends from it again, so a thread keeps one sender even
-- after it is reassigned to a team with an address of its own. Existing rows
-- stay null and are set at their next outbound email.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "thread_sender_address" text;
