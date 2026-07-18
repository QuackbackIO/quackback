-- Inbound-webhook dedupe for tracker close-the-loop system notes: a provider
-- that redelivers the same webhook (retry after our timeout, at-least-once
-- delivery) must not double-note a ticket thread. One note per (ticket,
-- delivery key) — composite because a single delivery legitimately fans out
-- to every ticket linked to the same external issue. Same idiom as the
-- inbound-email conversation_messages_email_message_id_idx.
CREATE UNIQUE INDEX "conversation_messages_inbound_delivery_key_idx" ON "conversation_messages" USING btree ("ticket_id",(metadata ->> 'inboundDeliveryKey')) WHERE (metadata ->> 'inboundDeliveryKey') IS NOT NULL;
