-- Drop the conversations.channel column default. Every create path now sets
-- channel explicitly, so a conversation on a new channel (email / web_form /
-- whatsapp / ...) can never be silently labeled messenger by an omitted insert.
-- The NOT NULL constraint stays, so an omission fails loudly instead.
ALTER TABLE "conversations" ALTER COLUMN "channel" DROP DEFAULT;
