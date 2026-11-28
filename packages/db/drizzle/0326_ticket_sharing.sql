-- @contract: additive
-- Sharing a customer ticket with other customers. A conversation participant
-- (§4.8 group threads) added to a conversation paired with a customer ticket
-- can now open the ticket's thread on the portal and in the widget, reply on
-- it, and keep their own read state. thread_access marks the rows that grant
-- that; it defaults to false so every existing group-thread participant keeps
-- exactly what they had (a copy of agent replies by email, no portal access).
-- last_read_at is the participant's own read watermark, so their reading
-- never moves the requester's (conversations.visitor_last_read_at). The
-- participant list per principal is already indexed
-- (conversation_participants_principal_id_idx).
ALTER TABLE "conversation_participants" ADD COLUMN IF NOT EXISTS "thread_access" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN IF NOT EXISTS "last_read_at" timestamp with time zone;
