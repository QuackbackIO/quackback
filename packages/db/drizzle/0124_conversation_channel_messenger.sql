-- Rename the conversations.channel value 'live_chat' to 'messenger': the
-- customer-facing widget surface is now "Messenger". Channel axis only. The
-- separate post_external_links.integration_type='live_chat' value is unchanged
-- (it marks a post linked from chat, a different concept).
UPDATE "conversations" SET "channel" = 'messenger' WHERE "channel" = 'live_chat';
ALTER TABLE "conversations" ALTER COLUMN "channel" SET DEFAULT 'messenger';
