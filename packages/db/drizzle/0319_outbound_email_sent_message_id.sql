-- @contract: additive
-- The Message-ID an outbound conversation email went out with, exactly as it
-- was sent. `message_id` keeps the lower-cased form a reply is matched
-- against; this column is what the next email repeats in In-Reply-To and
-- References, so a mail client that compares ids exactly keeps the thread.
-- Null on rows written before it existed: those threads keep repeating the
-- lower-cased form, which is all that was kept.
ALTER TABLE "conversation_outbound_emails" ADD COLUMN IF NOT EXISTS "sent_message_id" text;
