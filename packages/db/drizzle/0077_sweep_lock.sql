-- Lightweight cross-instance mutex for scheduled sweepers.
-- Used by withSweepLock() to ensure daily maintenance tasks
-- (audit log prune, invite expiry sweep) execute at most once
-- across all replicas in a multi-instance deployment.
--
-- Mechanism: INSERT ON CONFLICT DO UPDATE with a setWhere
-- expiry guard. The first instance that inserts wins; others
-- get zero rows returned and skip. On the next interval tick
-- the lock is re-acquired (the old holder's row has expired).
--
-- Not part of the drizzle schema — accessed via raw db.execute
-- in the sweep-lock helper. The table is purely infrastructure.
CREATE TABLE IF NOT EXISTS "sweep_lock" (
  "name" text PRIMARY KEY NOT NULL,
  "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
