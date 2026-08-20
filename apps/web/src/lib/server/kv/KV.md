# Redis's application half, on Postgres

The ~20 non-queue Redis call sites — the generic
cache, the rate-limit primitive and its consumers, pub/sub, presence, the daily
visitor salt, the sign-in device tracker, the link-preview limiter and the SSO
verify lock — run against the tenant's own Postgres database.

**Redis is gone entirely.** The queue half went to `jobs/` (`jobs/JOBS.md`), and
the final cutover has since removed what was left: `ioredis` is no longer a
dependency, `config.redisUrl` no longer exists, `health.ready.ts` no longer pings
anything but the database, and no compose file, deploy template or CI job
provisions a Redis. An eslint restricted-import guard keeps the queue
package out.

That cutover was deliberately held back until the queue half landed, because
`redisUrl` was a required config field with no fallback and readiness gated on a
Redis ping — so removing either piece alone would have left a half-migrated
tree. Both are done; what follows describes the finished state.

---

## 1. What replaced what

| Redis                                      | Here                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `GET` / `SET … EX` / `DEL`                 | `kv_store`, one row per (tenant, key), `expires_at` on every read             |
| `SET … EX … NX`                            | the same upsert with `WHERE kv_store.expires_at <= now()` on the conflict arm |
| `SET NX` then `GET` (the visitor salt)     | one `ON CONFLICT DO UPDATE … RETURNING value`                                 |
| `INCR` + `EXPIRE … NX`                     | `rate_bucket`, an arithmetic upsert whose `CASE` arms are the fixed window    |
| `SADD` + `EXPIRE NX`, `SREM` (device sets) | `kv_set_member`, expiry per member                                            |
| two sorted sets + an `EVAL` (presence)     | `presence_stream`, one row per live stream, `is_agent` a column               |
| `PUBLISH` / `SUBSCRIBE`                    | `pg_notify` on one channel per database, `LISTEN` on a direct connection      |

## 2. The tenant is stated twice, and that is not decoration

Every table leads its primary key with `tenant_id`, written from
`currentTenantNamespace()` — **the same function that built the `t:<tenantId>:`
prefix on the Redis wire key**. So the discriminator is not merely equivalent to
what it replaces; it is the same value, moved from a string prefix into a key
column. On a single-tenant install it is `'_'`, exactly as every key used to be
prefixed `t:_:`.

Under `QUACKBACK_TENANCY=pooled` the row is _additionally_ in the tenant's own
database, so cross-tenant observation needs both barriers to fail at once.

A key column is also strictly stronger than the prefix it replaces, for a reason
`cache.ts` records: half the cache key names are built by concatenation at the
call site, so a namespace applied by string building was always one
`${'settings:tenant'}:extra` away from being bypassed. The worst a malformed key
can do now is collide with another key of the same tenant.

**Pub/sub is the case that proves the redundancy earns its keep.** Its first
version keyed the in-process listener registry by `(tenant, channel)` and
otherwise relied on the database boundary alone. `pubsub.db.test.ts` then
delivered one tenant's inbox events to the other tenant's subscriber, because two
scopes on one database is a configuration nothing else in the system defends
against. The envelope now names its publishing tenant and `dispatch` refuses one
that disagrees with the connection.

## 3. Atomicity: one statement, except where one statement is not enough

Redis is single-threaded, so `INCR` and `SET NX` were indivisible for free. Here
that comes from being one statement — the row lock is taken and the `CASE` arms
evaluate under it. Split any of them into a read followed by a write and the race
is back.

**`clearPresence` is the exception, and finding that out cost a rewrite.** Its
first version did the delete and the "is anyone still here" check as two CTEs of
one statement. Every CTE in a statement shares one snapshot, so with 24 streams
closing at once **every** caller saw the other 23 rows still present and returned
`false`: the offline edge was claimed by **zero of 24**, not one. An agent's
unanswered conversations would never have been re-queued — silently, and only
under load. A single-threaded test cannot see this; 24 real connections can.

The fix is a transaction-scoped advisory lock keyed on (tenant, principal).
`pg_advisory_xact_lock`, never the session-scoped form: a session-level advisory
lock through a transaction-mode pooler fails open non-deterministically depending
on which backend the pooler picks, and survives client disconnect. An xact lock is
held by a transaction, which the pooler pins to one backend, and is released by
`COMMIT` whatever happens to the client.

## 4. Expiry is a predicate, never a sweep

Every read carries `expires_at > now()` (or a heartbeat cutoff). An expired row is
invisible the instant it expires whether or not `sweep.ts` has run. The hourly
sweeper reclaims space and **never decides correctness** — a missed sweep costs
disk, not staleness. Getting that backwards would make a down worker tier into a
correctness bug across every one of these stores.

## 5. `LISTEN` must be direct, and is only ever verified by delivery

Through a transaction-mode pooler a notify **never arrives — at one idle client,
not just under contention.** Measured by delivery on two separately provisioned
databases: 0/1 pooled across 16 runs, 0/6, 0/10; direct 1/1, 6/6, 10/10.

`pg_listening_channels()` is the **inverted** instrument: it reads `true` on the
pooled connection that delivers nothing and `false` on the direct one that
delivers. Nothing in `pg-listener.ts` asks it, and nothing should. `verify()`
sends a real NOTIFY from a _second_ connection and waits for it.

`pubsub.ts` opens one such connection per tenant, lazily on that tenant's first
SSE subscriber on this replica and closed when its last one leaves. A pooled
process holding N permanent session connections purely to receive notifies
would invert the reason for pooling; that concern is about a process that
listens for _every_ tenant. The bound here is _tenants with a live SSE stream on
this replica_, which is already proportional to a long-lived resource.

**Seam with the job tier:** the queue polls; it does not LISTEN. The realtime
bus is the only remaining session-mode listener (`realtime/pg-listener.ts`).
If a shared session-connection manager ever appears, the realtime bus is the
consumer that would join it.

## 6. The cost, measured once

The two paths the migration was expected to regress — rate limiting and
presence — were benchmarked once before the cutover. **The benchmark script is
not in the tree** (half of it drove the store that has since been deleted, so it
could not be re-run as written); the numbers below are the record of that
historical run, not a reproducible claim.

- **Rate limiting.** On loopback the bucket upsert read ~22–25× a pipelined
  Redis `INCR` at p50, but that figure is dominated by a per-statement WAL
  fsync a deployed database amortises. Paired against `SELECT 1` on the same
  connection to the deployed managed Postgres, the statement itself was
  sub-millisecond at p50 (+0.5 ms for the two-bucket sign-in shape; below the
  measurement floor for the single-bucket widget shape) with server-side
  execution at 0.019 ms/op. So the statement is essentially free and the whole
  cost is the round trip: **about 1–3 ms p50 added to the sign-in and widget
  hot paths**, one round trip, unchanged in count — paid per _rate-checked_
  request, never on ordinary page renders.
- **Presence.** Cheaper than expected, and the reason is structural: `is_agent`
  is a column rather than a second key to keep consistent, so the heartbeat is
  **one statement where Redis needed three commands** and the routing read one
  where it needed two — roughly +0.6 ms over `SELECT 1` at p50. The genuinely
  new cost is the _disconnect_ path, where `clearPresence` is a three-statement
  transaction because it has to serialize (§3): once per stream close, not
  three times a minute per stream.

The harness printed every ratio unconditionally and had no threshold to pass,
and one cell did come out below zero (the single-bucket delta), so a
"Postgres costs nothing here" result was a real possible outcome rather than an
artifact of the method.

## 7. What is NOT here

- **`bucketRetryAfter` costs a second round trip** where Redis's `TTL` did too. It
  is only called on the throttled path, so it is paid by requests already being
  refused. The count and the TTL come back together from `incrementRateBucket`
  and a future caller could take both from one call.
- **`incrementRateBuckets` collapses duplicate keys**, because
  `ON CONFLICT DO UPDATE` refuses to touch a row twice in one statement and a
  caller naming one key twice would otherwise take the whole request down. A
  Redis pipeline of two `INCR`s on one key would have counted two. The difference
  can only under-count, never over-throttle.
- **Oversized realtime payloads spill to a row.** `pg_notify` caps at 8000 bytes
  and a conversation event with a long body can exceed it. Steady state on a
  normal install is zero rows in `realtime_overflow`.

## 8. What the cutover must not have changed, and did not

Two invariants were called out as the things a "cutover" diff must leave alone.
Both hold:

- **The tenant discriminator.** `kv_store`, `rate_bucket`, `kv_set_member`,
  `presence_stream` and `realtime_overflow` still lead their primary key with
  `tenant_id`, written from `currentTenantNamespace()`. No migration was part of
  removing Redis.
- **`pg-listener.ts` stays on the direct DSN**, for the reason in §5.
