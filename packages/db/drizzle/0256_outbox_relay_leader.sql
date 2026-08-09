-- Leader election for the outbox relay, as a row rather than a session lock.
--
-- The relay has always elected one drainer per database. It did so with a
-- session-level `pg_advisory_lock` held on a dedicated connection
-- (`events/relay-lock.ts`), and that mechanism has three measured failure modes
-- once a connection pooler is anywhere in the picture:
--
--   1. it fails OPEN, non-deterministically. A second client routed onto the
--      same backend RE-ENTERS the lock and is told it won, so two relays both
--      believe they lead;
--   2. the lock survives the client disconnecting, so a dead leader keeps it,
--      and a direct client that then asks for it BLOCKS rather than failing —
--      measured dying twice on a 10s lock_timeout, recovering only after
--      pg_terminate_backend;
--   3. session state is not reset between clients on a pooled backend at all.
--
-- A row with an expiry has none of those properties. Acquire and renew are one
-- atomic statement with no session state, so the answer does not depend on
-- which backend the caller landed on, a dead leader's lease lapses on its own,
-- and a follower asking for it gets an immediate `false` instead of blocking.
--
-- `fence` increments on ACQUISITION only, never on renewal, so it is a
-- leadership epoch: a stalled leader that resumes can compare the fence it was
-- given against the one in the row and know it was superseded.
--
-- Replay-safe by construction: both statements are IF NOT EXISTS, and neither
-- writes a value. Applying this file twice leaves a byte-identical table.
CREATE TABLE IF NOT EXISTS "outbox_relay_leader" (
  "name" text PRIMARY KEY NOT NULL,
  "owner" text NOT NULL,
  "fence" bigint DEFAULT 1 NOT NULL,
  "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "renewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
COMMENT ON TABLE "outbox_relay_leader" IS 'Outbox relay leadership lease. One row per lease name, held by owner until expires_at. Acquire/renew is a single atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE, so it is correct through a transaction-mode pooler where a session advisory lock is not.';
