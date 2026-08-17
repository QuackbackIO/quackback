# Redis's application half, on Postgres

`SAAS-HOSTING-STACK.md` §7.4. The ~20 non-queue Redis call sites — the generic
cache, the rate-limit primitive and its consumers, pub/sub, presence, the daily
visitor salt, the sign-in device tracker, the link-preview limiter and the SSO
verify lock — run against the workspace's own Postgres database.

**Redis is gone entirely.** The queue half went to `jobs/` (`jobs/JOBS.md`), and
§7.4's final cutover has since removed what was left: `ioredis` is no longer a
dependency, `config.redisUrl` no longer exists, `health.ready.ts` no longer pings
anything but the database, and no compose file, deploy template or CI job
provisions a Redis. `policy/no-bullmq/` keeps the queue package out.

That cutover was deliberately held back until the queue half landed, because
`redisUrl` was a required config field with no fallback and readiness gated on a
Redis ping — so removing either piece alone would have left a half-migrated
tree. Both are done; what follows describes the finished state.

---

## 1. What replaced what

| Redis                                      | Here                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `GET` / `SET … EX` / `DEL`                 | `kv_store`, one row per (workspace, key), `expires_at` on every read          |
| `SET … EX … NX`                            | the same upsert with `WHERE kv_store.expires_at <= now()` on the conflict arm |
| `SET NX` then `GET` (the visitor salt)     | one `ON CONFLICT DO UPDATE … RETURNING value`                                 |
| `INCR` + `EXPIRE … NX`                     | `rate_bucket`, an arithmetic upsert whose `CASE` arms are the fixed window    |
| `SADD` + `EXPIRE NX`, `SREM` (device sets) | `kv_set_member`, expiry per member                                            |
| two sorted sets + an `EVAL` (presence)     | `presence_stream`, one row per live stream, `is_agent` a column               |
| `PUBLISH` / `SUBSCRIBE`                    | `pg_notify` on one channel per database, `LISTEN` on a direct connection      |

## 2. The workspace is stated twice, and that is not decoration

Every table leads its primary key with `workspace_key`, written from
`currentWorkspaceNamespace()` — **the same function that built the `t:<workspaceKey>:`
prefix on the Redis wire key**. So the discriminator is not merely equivalent to
what it replaces; it is the same value, moved from a string prefix into a key
column. On a single-workspace install it is `'_'`, exactly as every key used to be
prefixed `t:_:`.

Under `QUACKBACK_TENANCY=pooled` the row is _additionally_ in the workspace's own
database, so cross-workspace observation needs both barriers to fail at once.

A key column is also strictly stronger than the prefix it replaces, for a reason
`cache.ts` records: half the cache key names are built by concatenation at the
call site, so a namespace applied by string building was always one
`${'settings:workspace'}:extra` away from being bypassed. The worst a malformed key
can do now is collide with another key of the same workspace.

**Pub/sub is the case that proves the redundancy earns its keep.** Its first
version keyed the in-process listener registry by `(workspace, channel)` and
otherwise relied on the database boundary alone. `pubsub.db.test.ts` then
delivered one workspace's inbox events to the other workspace's subscriber, because two
scopes on one database is a configuration nothing else in the system defends
against. The envelope now names its publishing workspace and `dispatch` refuses one
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

The fix is a transaction-scoped advisory lock keyed on (workspace, principal).
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
not just under contention.** Measured by delivery on two Neon projects: 0/1
pooled across 16 runs, 0/6, 0/10; direct 1/1, 6/6, 10/10.

`pg_listening_channels()` is the **inverted** instrument: it reads `true` on the
pooled connection that delivers nothing and `false` on the direct one that
delivers. Nothing in `pg-listener.ts` asks it, and nothing should. `verify()`
sends a real NOTIFY from a _second_ connection and waits for it.

`pubsub.ts` opens one such connection per workspace, lazily on that workspace's first
SSE subscriber on this replica and closed when its last one leaves. §7.3 warns
that a pooled process holding N permanent session connections purely to receive
notifies inverts the reason for pooling; that warning is about a process that
listens for _every_ workspace. The bound here is _workspaces with a live SSE stream on
this replica_, which is already proportional to a long-lived resource.

**Seam with the job tier:** `pg-listener.ts` is a deliberate sibling of
`jobs/wake.ts` rather than an edit to it — that file is load-bearing for the
queue doorbell. If the job tier grows a shared session-connection manager,
this is the other consumer and should join it.

## 6. The two regressions §7.4 names, measured

### Method

Two instruments, because one of them cannot resolve what the other can.

1. **Like-for-like, both stores on loopback** (a Redis-compatible server and
   Postgres 17 in Docker on the same host): the exact Redis command sequence the
   old code issued against a real Redis, and the exact statement the new one
   issues against a real Postgres, from one process. 400 iterations, 20 warm-up
   calls discarded.
2. **Paired against `SELECT 1` on a real Neon compute**, `aws-us-east-1`, on a
   **throwaway project nobody else was on** (`gauntlet-p8-bench`, created and torn
   down for the measurement — a shared workspace compute has other pieces' pollers on
   it and its numbers cannot be trusted). Every sample is
   `statement − immediately-following SELECT 1` on the same connection, so link
   jitter cancels instead of being attributed to the statement. n=250.

The benchmark script itself is not in the tree: half of it drove the store that
has since been deleted, so it could not be re-run as written. The figures below
are the record of that run.

**What these would have shown had the hypothesis been false.** The hypothesis is
that Postgres costs more per operation than Redis on these paths. A ratio ≤ 1 in
(1), or a delta ≤ 0 in (2), is a real possible outcome — and one cell produced
exactly that: the widget single-bucket delta came out at **−0.205 ms**, i.e. below
the measurement floor. The scripts printed every ratio unconditionally and had no
threshold to pass.

### Rate limiting — §7.4's first regression

|                             | Redis (loopback) | Postgres (loopback) | ratio |
| --------------------------- | ---------------- | ------------------- | ----- |
| sign-in shape, 2 buckets    | **0.154 ms** p50 | 3.461 ms p50        | 22.5× |
| widget mint shape, 1 bucket | **0.130 ms** p50 | 3.272 ms p50        | 25.2× |

Round trips are **1 in both** — Redis pipelined; Postgres uses one statement.

The loopback Postgres figure is dominated by a WAL fsync to a Docker volume, and
that is **not** what a Neon workspace pays. On the dedicated Neon compute, paired
against `SELECT 1` on the same connection:

|                             | delta over `SELECT 1`, p50   | p95      |
| --------------------------- | ---------------------------- | -------- |
| sign-in shape, 2 buckets    | **+0.545 ms**                | +13.2 ms |
| widget mint shape, 1 bucket | **−0.205 ms** (at the floor) | +17.4 ms |

Server-side execution alone, timed in a PL/pgSQL loop with the network amortised
away: **0.019 ms/op** for the bucket upsert against **0.0009 ms/op** for
`PERFORM 1`.

**So the statement is essentially free and the whole cost is the round trip.**
On the deployed pairing (Railway `us-east4` ↔ Neon `us-east-1`, measured at 0–3 ms
RTT with a 7 ms tail over 217 samples), a rate-checked request pays roughly
**1–4 ms p50** where a Railway-private Redis would have paid a few hundred
microseconds. **Net: about 1–3 ms p50 added to the sign-in and widget hot paths,
one round trip, unchanged in count.**

That is a real cost and it is worth stating plainly rather than defending: it is
per _rate-checked_ request, so it lands on sign-in and on the widget's
unauthenticated entry points, not on ordinary page renders.

### Presence — §7.4's "most expensive item"

|                                     | Redis (loopback) | Postgres (loopback) | round trips |
| ----------------------------------- | ---------------- | ------------------- | ----------- |
| heartbeat, per live stream per 20 s | 0.190 ms p50     | 3.287 ms p50        | **3 → 1**   |
| `listOnlineAgentIds` (routing)      | 0.141 ms p50     | 0.236 ms p50        | **2 → 1**   |

On the dedicated Neon compute: heartbeat **+0.584 ms** over `SELECT 1` (p50),
routing read **+0.251 ms**; 0.015 and 0.049 ms/op server-side.

**§7.4 over-rated this one, and the reason is structural.** The Lua script and the
second sorted set both existed to keep two Redis keys consistent. There is no
second key here — `is_agent` is a column, and "which agents are online" is derived
rather than maintained — so the heartbeat is **one statement where Redis needed
three commands**, and the routing read is one where Redis needed two. The volume
is also small: S live streams cost S/20 writes per second per workspace, so 100
concurrent agent streams is **5 writes/second**.

The genuinely new cost is on the _disconnect_ path, not the heartbeat: a
`clearPresence` is now a three-statement transaction because it has to serialize
(§3). That is once per stream close, not three times a minute per stream.

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

- **The workspace discriminator.** `kv_store`, `rate_bucket`, `kv_set_member`,
  `presence_stream` and `realtime_overflow` still lead their primary key with
  `workspace_key`, written from `currentWorkspaceNamespace()`. No migration was part of
  removing Redis.
- **`pg-listener.ts` stays on the direct DSN**, for the reason in §5.
