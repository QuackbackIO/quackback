-- Redis's application half, moved into the tenant database.
--
-- Four substrates, one property. Every table here carries `tenant_id` as the
-- leading column of its primary key, and every statement that reads one filters
-- on it. That is the literal successor of the `t:<tenantId>:` prefix
-- `tenancy/tenant-keyed.ts` puts on every Redis key today — the same
-- discriminator, moved from a string prefix into a key column so a query that
-- forgets it cannot compile past review, where a key that forgets it merely
-- reads the wrong row.
--
-- ## The tenant segment is stated twice on purpose
--
-- Under `QUACKBACK_TENANCY=pooled` these tables live in the tenant's OWN
-- database, so cross-tenant observation is already impossible: there is no
-- shared keyspace to collide in. `tenant_id` is the second, independent
-- statement of the same fact — the shape `0250_job_queue.sql` established, for
-- one reason: a wrong-tenant answer passes every other check in the
-- system, so a store asserts its own boundary rather than inheriting confidence
-- from the connection that reached it.
--
-- On a single-tenant install `tenant_id` is `'_'`, matching
-- `SINGLE_TENANT_NAMESPACE`. One namespace, never absent, so pooled and single
-- run the same statements rather than two paths that can drift.
--
-- ## Expiry is a predicate, not a background job
--
-- Redis dropped a key when its TTL elapsed. Here every read carries
-- `expires_at > now()`, so an expired row is invisible the instant it expires
-- whether or not anything has swept it. The sweeper in
-- `lib/server/kv/sweep.ts` reclaims space; it is never what makes expiry
-- correct. Getting that backwards would make a late sweep into a stale read.

-- ---------------------------------------------------------------------------
-- 1. kv_store — the generic cache, plus every SET-NX lock and single value
--    (`visitor:salt:*`, `verify-domain:*`, `segment:identify:*`).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kv_store" (
  "tenant_id" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "kv_store_pkey" PRIMARY KEY ("tenant_id", "key")
);

CREATE INDEX IF NOT EXISTS "kv_store_expires_at_idx" ON "kv_store" ("expires_at");

-- ---------------------------------------------------------------------------
-- 2. rate_bucket — the fixed-window counter behind every rate limiter.
--
--    Separate from kv_store because its update is a different statement (an
--    arithmetic upsert that also resets the window) and because its churn
--    profile is different: a hot bucket is rewritten on every request, and
--    mixing that with cached settings rows would put cache reads behind
--    rate-limit row locks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "rate_bucket" (
  "tenant_id" text NOT NULL,
  "key" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "window_expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "rate_bucket_pkey" PRIMARY KEY ("tenant_id", "key")
);

CREATE INDEX IF NOT EXISTS "rate_bucket_window_expires_at_idx"
  ON "rate_bucket" ("window_expires_at");

-- ---------------------------------------------------------------------------
-- 3. kv_set_member — the one Redis SET we used: `user:devices:<userId>`.
--
--    Redis expired the whole set; here each member carries the set's expiry, so
--    "the set aged out" and "this member aged out" are the same predicate. That
--    is a faithful port because the only writer refreshes every member together
--    (`markDeviceSeen`), never one member alone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kv_set_member" (
  "tenant_id" text NOT NULL,
  "set_key" text NOT NULL,
  "member" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "kv_set_member_pkey" PRIMARY KEY ("tenant_id", "set_key", "member")
);

CREATE INDEX IF NOT EXISTS "kv_set_member_expires_at_idx"
  ON "kv_set_member" ("expires_at");

-- ---------------------------------------------------------------------------
-- 4. presence_stream — one row per live SSE stream.
--
--    Redis held two keys: a per-principal sorted set of streams, and a
--    fleet-wide `conversation:presence:agents` set. Keeping them consistent is
--    what the Lua script in `realtime/presence.ts` existed for — remove the
--    stream, prune stale members, and drop the principal from the agents set
--    only if nothing remains, all without an interleave.
--
--    Here `is_agent` is a COLUMN on the stream row, so there is no second key to
--    keep consistent. "This principal is an online agent" is derived
--    (`EXISTS (… WHERE is_agent AND heartbeat_at > cutoff)`) rather than
--    maintained, and the class of drift the Lua script prevented cannot occur.
--    What still needs atomicity is deciding "was that the last live stream",
--    which `clearPresence` does in one statement.
--
--    `principal_id` is text, not a uuid FK. Presence is not a fact about the
--    principal row: a stream outliving a deleted principal must age out, not
--    block the delete, and Redis had no such reference either.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "presence_stream" (
  "tenant_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "stream_id" text NOT NULL,
  "is_agent" boolean NOT NULL DEFAULT false,
  "heartbeat_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "presence_stream_pkey" PRIMARY KEY ("tenant_id", "principal_id", "stream_id")
);

-- `presence_stream_agents_idx`, which serves `listOnlineAgentIds()` /
-- `isAnyAgentOnline()`, is created by 0258 and not here. It is the only
-- statement in this file that named a column rather than a relation, and 0258
-- renames that column. `CREATE INDEX IF NOT EXISTS` resolves its column list
-- before it checks whether the index name is taken, so it does not skip -- it
-- raises `column "tenant_id" does not exist` -- against a database where the
-- rename has already happened. That would abort every replay of this file, and
-- the fleet migrator replays this file: no later migration can repair it,
-- because a later migration runs after the statement that failed. Creating it
-- on the far side of the rename is the only ordering in which both a fresh
-- install and a replay work.

CREATE INDEX IF NOT EXISTS "presence_stream_heartbeat_idx"
  ON "presence_stream" ("heartbeat_at");

-- ---------------------------------------------------------------------------
-- 5. realtime_overflow — the payloads pub/sub cannot carry inline.
--
--    `pg_notify` caps a payload at 8000 bytes; Redis PUBLISH has no such limit,
--    and a conversation event carrying a long message body can exceed it. A
--    dropped event is a message the agent never sees, so the oversized case
--    spills to a row and the NOTIFY carries the row id instead.
--
--    Rows are deleted by the subscriber that reads them and swept on expiry, so
--    this table is empty in steady state on any install whose events fit inline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "realtime_overflow" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "channel" text NOT NULL,
  "payload" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "realtime_overflow_expires_at_idx"
  ON "realtime_overflow" ("expires_at");
