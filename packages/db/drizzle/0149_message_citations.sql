-- Per-message AI citations: the KB sources the assistant grounded a reply in.
-- The message `content` carries inline [n] markers that index this ordered list;
-- null for human-authored messages.
ALTER TABLE "conversation_messages" ADD COLUMN "citations" jsonb;
