# Pooled multi-tenancy

One process, many workspaces, one Postgres database each, workspace decided per
request from the `Host` header.

This document states the resolution order, what happens on every failure mode,
how pool eviction is tuned and measured, and which background subsystems are
scoped versus deferred. Authority is `SAAS-HOSTING-STACK.md` §3, §5, §6, §7.3,
§8, §10.5; the data contract is `quackback-cp/docs/workspace-registry-contract.md`.

`QUACKBACK_TENANCY=single` is the default and is byte-for-byte today's
behaviour: one `DATABASE_URL`, one memoized connection, no registry, no
middleware work. Everything below applies to `pooled`.

---

## 1. Why this piece is unusual

If workspace resolution returns the wrong connection pool, **every RBAC and
permission check still passes.** That database's own `settings`, `principal` and
`roles` rows are entirely self-consistent, so authorization succeeds against the
wrong workspace's data. It does not error. It looks correct.

There is no second gate. So the design is arranged so that the only way to reach
a connection is through a record that is complete, valid, active _and_
fingerprinted, and so that the failure of any one of those is loud.

Two consequences run through every file here:

- **Absence is an error, never a default.** No fallback workspace, no fallback
  database, no "degrade to the first workspace". A fallback is the same failure
  with a friendlier name.
- **Only one variant carries connection material.** The resolver's return type
  makes a suspended, unknown or malformed record structurally unable to produce
  a DSN. That is the fail-closed property expressed as a type rather than as a
  convention, and it is worth keeping that way in any change here.

---

## 2. Resolution order

```
Host header
  → normalise                      (lowercase, strip port and trailing dot; reject / @ [ *)
  → registry lookup                (control-plane Postgres, one join, in-process TTL cache)
  → state gate                     (active? suspended? deleting?)     ← no workspace DB touched yet
  → contract validation            (the vendored predicate, not a local reading)
  → pool acquire                   (LRU, keyed by workspace id, built or reused)
  → fingerprint assertion          (once per pool, three independent facts)
  → runWithWorkspaceScope(...)        (AsyncLocalStorage)
  → CSRF, auth, and everything else
```

Registered in `start.ts` as `[requestContextMiddleware, workspaceContextMiddleware,
csrfMiddleware]`.

**Workspace is resolved before auth, and that ordering is the piece.**
`middleware/request-context.ts` has always enriched `workspace_key` into the log
context _"once auth resolves"_ — but auth resolution is itself full of
`db.query.*` calls, so that value lands long after the connection it was meant to
choose. Workspace resolution touches only the control database and completes before
any workspace-database query exists.

### Where the workspace lives once resolved

On the request-scoped `AsyncLocalStorage` store that `request-context.ts` already
opens for every SSR document, server route and server function, under a symbol
key — the same mechanism `functions/auth-request-cache.ts` already uses for its
per-request memo. `@quackback/logger` owns the store and shares it with
`@quackback/db` and `@quackback/email`, so a scoped log line carries `workspace_key`
without anyone passing it down.

`runWithWorkspaceScope` always opens a **nested** ALS run rather than mutating the
enclosing store. Mutate-and-restore looks cheaper and is wrong: the body is
usually async, so a `finally` fires when the promise is _created_, not when it
settles, and the scope would vanish before the first query.

### The `db` Proxy

537 files import `db` from `@/lib/server/db`. **None of them changes.** The trap
resolves the handle on every property access; call sites never learn the
connection became per-request.

The trap did have a latent bug: it dropped the receiver, so `db.select(...)` ran
with `this === proxy`. That worked only because `getDatabase()` returned one
memoized singleton, so the re-entrant lookups resolved to the same object anyway.
A workspace-aware trap removes that accident, so function properties are now bound
to the handle they came from and `Reflect.get` is given that handle as the
receiver. The pattern already existed in-repo at
`__tests__/db-test-fixture.ts:59-62`.

---

## 3. Every failure mode

| Outcome                                                  | Status                              | Workspace DB touched | Notes                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                                                     | serves                              | yes                  |                                                                                                                                                                                                                         |
| `unknown_host` — no registry record claims this hostname | **404**                             | no                   | Also the shape a port scan produces; cached briefly so it does not become a control-DB amplifier                                                                                                                        |
| `suspended` — record exists, gated off                   | **403** + reason                    | no                   | State is checked _before_ validation, so suspending a workspace whose record is stale still reads as "suspended" rather than as corruption                                                                              |
| `deleting` — teardown in flight                          | **410**                             | no                   |                                                                                                                                                                                                                         |
| `invalid` — a record exists but fails the contract       | **503**, alert                      | no                   | Should essentially never fire: the control plane's write path refuses to commit a record its own reader would reject. If it fires, something edited the control database by hand or the reader is older than the writer |
| `refused` — the database is not the one the record named | **503**, alert                      | one query            | §3's failure, caught                                                                                                                                                                                                    |
| credential ref unresolvable                              | **503**, alert                      | no                   | Fails fast and by name (see below)                                                                                                                                                                                      |
| no workspace scope at all, in pooled mode                | throws `WorkspaceScopeMissingError` | no                   | The background-subsystem tripwire                                                                                                                                                                                       |

Every refusal is `Cache-Control: no-store`. A cached 404 or 503 on a shared edge
would pin a workspace into an outage long after its record was fixed.

**No refusal body carries operator detail.** The visitor gets "This workspace is
temporarily unavailable"; the log gets `REFUSED [self_reported_workspace_id_mismatch]
settings.id is 019f…, expected 019f…`. Leaking the identifiers would be an
information leak about _another_ workspace.

### The fingerprint: three independent facts

Checked once per pool, cached per pool, never per request.

| Fact                      | Written by                      | Beaten by              |
| ------------------------- | ------------------------------- | ---------------------- |
| `settings.id`             | nobody — it is a primary key    | a copy of the database |
| the control plane's stamp | the control plane, deliberately | a copy of the database |
| `pg_database.oid`         | the catalog, per database       | nothing we can reach   |

`settings` is exactly one row per database — the app's own `requireSettings()` is
a `findFirst()` with no `WHERE` clause — which is what makes the database the
workspace boundary in the first place. Anything other than exactly one row is a
refusal.

The first two are decided by `evaluateFingerprint`, **vendored byte-for-byte**
from the control plane into `vendor/contract.ts`. It is copied rather than
paraphrased because two repos independently reading the same prose is exactly how
one of them ends up with a slightly more forgiving version, and the forgiving one
is the one that serves the wrong workspace. `__tests__/vendor-parity.test.ts` guards
the copy with a committed digest (always runs) _and_ a direct comparison against
the control-plane checkout (runs when one is present — a skipped check reports
success, which is why it is not the only check).

**The third fact exists because a dump/restore or `TEMPLATE` clone is
indistinguishable from its parent by the first two.** Cloning copies data, so a
clone carries a byte-identical `settings.id` and a byte-identical stamp. That
matters more than it first appears: cloning is exactly what §10.8 recommends
for migration preflight, so _the most likely operational mistake is the one the
content fingerprint cannot catch._ Fleet Postgres records `current_database()`
and `pg_database.oid` at provision — properties of the catalog, not of the
data. A restore into a new database keeps the stamp and gets a new oid. A
record that _claims_ a catalog oid and reaches a database with a different one
is refused; a record claiming no catalog placement skips the check.

Demonstrated live, 2026-08-08, against the gauntlet workspaces:

```
t1 record → t2's database    HTTP 503   REFUSED [self_reported_workspace_id_mismatch]
                                        settings.id is 019fe1d3-…, expected 019fe1ca-…
t1 record → a CLONE of t1    HTTP 503   REFUSED [catalog_oid_mismatch]
                                        pg_database.oid is 9999, expected 4242
t1 record → t1              HTTP 200
```

The clone case is the one that used to pass.

### Where the stamp is read from

Preferentially from **`settings.cloud_workspace_key`**, a dedicated column
(migration `0251`). The stamp's original home is the `settings.metadata` JSON
bag, and `telemetry/instance-id.ts` performs an unlocked, unattended **hourly**
read-modify-write of that same bag which never invalidates the settings cache —
so it can interleave with a stamp write and drop it. A column removes the class
rather than narrowing the window.

The column is read through `to_jsonb(s) ->> 'cloud_workspace_key'` rather than by
name, so the query still runs against a database that predates `0251` and simply
reports the column absent. That matters because the fingerprint is the _first_
thing a pooled process does with a workspace database, and refusing to look because
of a migration-ordering problem would turn an expand-only migration into an
outage. When both sources are present and disagree, that is its own refusal
(`stamp_source_conflict`) — two writers claiming different owners is not a state
to pick a winner from.

**`cloud_workspace_key` is deliberately NOT added to the Drizzle schema.** The app
never reads or writes it; only the raw fingerprint query does. Adding it to the
ORM would make every `settings` select in the app emit the column name, so every
workspace that had not yet run `0251` would fail on _unrelated_ reads — a real cost
for a column the app has no use for. §5's ordering rule (expand lands before the
code that reads it) is respected by not creating the dependency at all.

---

## 4. Pool management

An LRU of `postgres()` pools keyed by workspace id.

| Knob                          | Default | Why                                                                                                                                    |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_POOL_MAX`          | 3       | One instance holds N workspace pools and the fleet pooler multiplexes anyway; 10 per workspace would be N×10 sockets for no throughput |
| `WORKSPACE_POOL_MAX_ENTRIES`  | 50      | LRU cap per instance                                                                                                                   |
| `WORKSPACE_POOL_IDLE_SECONDS` | 45      | See below — this is the number the cost model rests on                                                                                 |
| `WORKSPACE_REGISTRY_TTL_MS`   | 30 000  | Hostname → record cache; `revision` invalidates within the window                                                                      |

Pools terminate at the **pooled** (transaction-mode) endpoint. The direct
endpoint is reserved for session-mode consumers — `LISTEN`, `pg_advisory_lock`,
`CREATE INDEX CONCURRENTLY` — which is why the record carries both.

`prepare: true` is kept. Protocol-level prepared statements are verified safe
through the transaction-mode pooler under real backend reassignment. The
boundary is that Drizzle emits explicit column lists; hand-written `SELECT *`
in a migration-adjacent path would break it.

### Credential rotation

`postgres.js` accepts a **function** for `password` and calls it on every new
connection, so a rotated credential is picked up by reconnecting rather than by
wedging: existing sockets keep working, the next one resolves fresh. `dbRole` is
a first-class field on the record for exactly this reason. `sealed+aead://`
database refs are opened under the fleet root — the password is a value we
issued, and the blob rides in the same registry row as the DSN.

The credential is additionally resolved **once, eagerly, before the first
connection** — not for caching, but for the error. A password provider that
throws is swallowed by the driver and re-reported as `CONNECT_TIMEOUT` fifteen
seconds later, which is both slow and names the wrong cause.

### Eviction is the cost model, not memory hygiene

The fleet suspends a compute when **no client is connected**. An open pool holds the
database awake, so eviction is the single thing that makes an idle workspace cost
storage only instead of running compute indefinitely. The same
silence is what lets a Railway `role=web` service sleep, since Railway's rule
triggers on ten minutes without an _outbound_ packet.

So `WORKSPACE_POOL_IDLE_SECONDS` must sit comfortably below **both** the
database `suspend_timeout_seconds` (300 s default) and
Railway's 600 s window. 45 s is the default; the gauntlet measurement ran at 20 s.

Two layers do the work. `postgres.js` closes idle _sockets_ after `idle_timeout`,
which is what actually lets the compute suspend. A sweep additionally drops the
pool object, which stops a workspace routed here once from holding an LRU slot
forever and makes the eviction counter meaningful.

**Measure it; do not reason about it.** Get this wrong and every workspace ever
routed to an instance stays awake forever — silently, with **no functional
signal at all**. That absence of symptom is why `getPoolCacheStats()` exposes
`evicted`, `evictedByReason` and `evictionsPerHour` as first-class counters
rather than debug logs: the counter is the only thing that distinguishes
"working" from "quietly costing money".

**Eviction is necessary but not sufficient.** A permanently attached LISTEN
holds the compute awake whether or not the request pool evicted. The
connectionless scheduler (`QUACKBACK_WAKE_MODE=scheduler`) does not LISTEN
and does not hold a tenant connection between drains, so `ROLE=all` on the
HTTP process can still let a quiet workspace suspend. The detach policy in
`idle.ts` is what lets a listener-mode workspace go. The role split is
optional scale-out, not the precondition for idle saving.

#### Measured, 2026-08-08

Local pooled fleet, `QUACKBACK_ROLE=web`, `WORKSPACE_POOL_IDLE_SECONDS=20`, against
`gauntlet-ws-t3` (its own catalog, default 300 s suspend). The
method polls the compute for `current_state = idle` **before** the trial: a
suspend/wake measurement without a verified pre-state measures nothing.

| Step                                                              | Observed                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| verified pre-state                                                | `idle`                                                                                         |
| cold request (`GET /api/widget/config.json`, Host `t3.localhost`) | HTTP **200 in 3 s** — compute wake + first pool build + fingerprint + render, all cold         |
| state immediately after                                           | `active`                                                                                       |
| pool evicted                                                      | **+25.2 s** after last use, `reason: idle`, socket closed (20 s threshold, swept every ~6.7 s) |
| compute returned to `idle`                                        | **+337 s** after last traffic, polled every 15 s                                               |

337 s against a documented 300 s `suspend_timeout_seconds`, of which the first
~25 s is the pool still holding a socket open. So the compute suspended roughly
312 s after the connection actually closed — consistent with the 306–309 s
time-to-suspend measured independently elsewhere in this run, and it confirms the
causal claim rather than merely the correlation: **the compute suspends because
the pool let go.**

Open question 2 of `SAAS-HOSTING-STACK.md` ("does pool eviction actually let the
compute suspend?") is answered yes under a process that holds no idle tenant sockets.
That is `ROLE=web`, or `ROLE=all` with the connectionless scheduler. It is not
true of a listener-mode `ROLE=all` that keeps LISTEN attached.

---

### Running the isolation probe against this fleet

`apps/web/workspace-probe/` is the instrument this piece exists to satisfy. Two
things about running it here are not obvious and cost a full run each:

**Tear the fixture down between orderings.** The suite derives its canaries from
the _slot_ (`alpha`/`bravo`) while its fixture is find-or-create against a
stable slug and therefore persists per _workspace_. Boards are never rewritten;
posts are. So re-running with the workspace↔slot mapping swapped leaves each workspace
holding the previous run's slot canary, and the suite reads that as the other
workspace's data — in both directions, symmetrically, with nothing having crossed.
And **`--teardown` is not sufficient**: it removes the fixture the _current_
configuration names, so rows created under a different workspace↔slot mapping
survive it and accumulate. After three runs each workspace held two boards and two
posts, each carrying whichever slot canary it held when that row was written,
and P07 reported a LEAK in both directions from it.

The check that separates accumulation from a real leak is **row identity, not
canary counts**: a cross-workspace write puts the same row id in both databases.
Accumulation leaves every id distinct, each created locally. Verified here —
zero overlap, and `settings.name` (planted per workspace and never rotated) stayed
correct on both, which is the control that proves nothing crossed.

Delete by canary in SQL rather than relying on `--teardown` between orderings.

**P06 cannot see, and moving the identity token will not fix it.** Both
hypotheses in an earlier draft of this file were wrong and each costs a full run
to disprove — `settings.name` is not the problem and the portal welcome-card
headline is not the answer. **`/` is unconditionally a 307, and the probe does
not follow redirects**, so P06's only token-bearing judged surface always has an
empty body regardless of where the token is planted. Fixing it means either
giving the suite a non-redirecting judged surface or teaching it to follow the
redirect; it is not a fixture task.

Two fixture faults are worth knowing because they invalidate earlier P06
attempts: `settings.portal_config` can end up holding **invalid JSON**
(`{}{"welcomeCard":…}`) if it is written as
`COALESCE(pc::jsonb,'{}') || obj::text` — `::text` binds tighter than `||`; and
an empty `settings.setup_state` makes `__root.tsx` redirect every non-exempt
path to `/onboarding`.

**Two properties of the suite are weaker than its README claims.** Recorded here
because they change how a run should be read; neither is fixed here, and neither
should be fixed by anyone reading this file rather than by the suite's owner.

- **A failing `invariant` can be downgraded rather than counted.** The README
  says _"there is no filter that can record a signal without counting it"_, and
  for P03 that is not true: it returns through an early `error()` that bypasses
  `decide()`, so a control class the suite maps to `LEAK` surfaces as `ERROR` —
  exit 1, not 2. **The same early-return shape appears in 7 of the 9 probes.** A
  clean exit code is therefore weaker evidence than the README implies; read the
  per-control detail.
- **P03's inferred capability no longer exists.** It infers a cross-workspace read
  from one shared storage secret, but `storageReadSig` now signs
  `workspaceBind('read|<key>')`, so a capability minted for one workspace does not
  verify on another _even on a single shared secret_. The suite cannot see that,
  and `crypto-drift.test.ts` cannot either, because it runs unscoped and
  `workspaceBind` preserves the unscoped message byte-for-byte — which is exactly
  the property that keeps self-hosted installs unchanged.

### The surface the isolation probe cannot judge

The Piece 1 probe suite's own README records `/api/widget/config.json` as
unguarded for any workspace on a greyscale or default brand colour: the planted
identity token lives in the workspace name or the portal welcome headline, and
that surface carries neither — only colours. So it was checked directly, on the
live pooled fleet, with a positive control on every assertion.

Two workspaces were given distinct brand colours through custom CSS (the path
`extractThemeFromCss` actually reads) and the shared settings cache was dropped
between orderings:

| Order                                       | Result                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| cold, alpha first                           | PASS — each host served **its own** colour, neither served the other's |
| cold, bravo first                           | PASS                                                                   |
| six alternating requests, then re-read both | PASS                                                                   |

The ordering matters and is not decoration. A cache that is last-writer-wins is
asymmetric: testing one direction leaves detection to whichever workspace's value
happened to survive, which is a defect class this run has already been bitten by.

**The positive control is the load-bearing part.** A first pass of this check
reported PASS on every surface while _neither_ host served its own marker at all
— both workspaces were freshly provisioned and redirected to `/onboarding`, so the
bodies were identical and empty of identity. An "isolation" result from a surface
that renders no identity is not a result. The check now reports `ERROR` rather
than `PASS` whenever a host fails to serve its own marker.

---

### Per-workspace `SECRET_KEY` and storage credentials

Both are resolved from the registry record on **pool checkout**, in the same
pass as the fingerprint, and carried on the workspace scope. That placement is the
design rather than a convenience:

- **Atomic with the DSN.** §4.3 asks for the secret ref to resolve "correctly
  _and_ atomically with `databaseUrl`". Both come off one record, read once, and
  are resolved in one function against one `WorkspaceDescriptor`. A mix-up is not
  expressible.
- **Once per pool.** Same cadence as the fingerprint, for the same reason: it is
  a property of the workspace, not of the request.
- **Synchronously readable afterwards.** `buildPublicUrl`, `getPublicUrlOrNull`
  and every storage gate are synchronous and called from hundreds of places.
  Resolving on the checkout path is what lets them stay that way.

#### Two schemes, because the two halves are not the same problem

| Half         | Scheme                                            | Why                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SECRET_KEY` | `derived+hkdf://v<gen>/<workspace>/app-secrets`   | A value **we** choose. Nothing outside the system has to agree with it, so it need not be stored: HKDF from one fleet root (`QUACKBACK_FLEET_ROOT_KEY`) with the workspace id as domain separation. No store, no network hop, no handoff — custody stops being a delivery problem, which is the failure that shipped once already on the database credential |
| S3 keys      | `sealed+aead://v<gen>/<workspace>/storage/<blob>` | A value **Cloudflare** chose. No derivation produces it, so it is carried — sealed under a key derived from the same root and bound to the workspace, with the blob riding **in the reference**, so it is read in the same row and the same query as the DSN                                                                                                 |

**Blast radius, stated plainly.** One root opens every workspace. That is weaker
than an external custodian holding N independent secrets, and it is the
destination. It is _not_ a regression: today every pooled workspace shares one
literal `SECRET_KEY`, so a root that yields a different key per workspace is
strictly better than what it replaces. The generation in every ref is what keeps
the move to external custody, or a root rotation, a migration rather than a flag
day.

**Storage chose per-workspace scoped tokens over one fleet-wide R2 credential, and
the reason is a second gate.** With a fleet key, a record naming the wrong bucket
succeeds — one workspace reads and writes another's objects and nothing errors, the
§3 failure moved to object storage. With a per-workspace scoped token the same
mis-wiring is refused **by the provider**: measured, `Access Denied`. The
credential is the gate storage would otherwise not have. The residual case this
does not catch is a record carrying _both_ the wrong bucket and the matching
sealed credential, which is a whole-record swap.

#### The `SECRET_KEY` canary

A wrong key does not announce itself. AES-GCM fails closed, so nothing is forged
and nothing is corrupted — but the fleet goes on **writing** ciphertext under the
wrong key while the old stops opening, and §4.3 records that this makes an entire
class of stored data permanently unrecoverable with no alarm beyond scattered
per-call errors.

So the key gets the treatment §3 gives the database. The control plane seals a
constant under the workspace's own `SECRET_KEY` into `settings.cloud_secret_canary`
(migration `0252`), and the fleet opens it on pool checkout:

| Observation          | Verdict                                     |
| -------------------- | ------------------------------------------- |
| canary opens         | serve                                       |
| canary does not open | `REFUSED [secret_key_canary_mismatch]`, 503 |
| canary absent        | `REFUSED [secret_key_canary_missing]`, 503  |

Absence is a refusal for the same reason a missing stamp is: "no evidence" and
"good evidence" must not produce the same outcome when what is at stake is
whether a write is about to seal data under a key that will not open it again.
Read through `to_jsonb(s) ->> 'cloud_secret_canary'` and kept out of the Drizzle
schema, exactly as `cloud_workspace_key` is, so a database that predates `0252` still
answers the query.

Sealed rather than hashed: a hash of the key would be an offline-guessable
verifier sitting in a database; a sealed constant proves possession and publishes
nothing.

**The canary has exactly one writer, and it never overwrites blind.** A process
holding the wrong root would otherwise derive the wrong key, replace the canary
with one that matches it, report success, and leave a serving workspace permanently
refused — the check defeated by its own writer. So an existing canary that does
not open under the key about to be installed is a refusal, overridable only by an
explicit re-key. Migration `0252` adds the column and **never writes a value**,
which is what keeps a replayed migration inert: `ADD COLUMN IF NOT EXISTS` plus a
`COMMENT`, verified by replaying it twice against two live workspaces with the
canary byte-unchanged.

**An `env://` app-secret ref must name its own workspace's variable.** Such a ref
carries no workspace, so the ref-names-workspace check has nothing to read, and without
this two hand-edited records could name one variable and silently share a
`SECRET_KEY` — which the canary cannot see, because both workspaces would derive the
same key and both canaries would open. The variable name is derived from the
workspace id (`workspaceAppSecretVariable`), so a collision is not expressible.

#### The two halves fail in different directions

| Failure                              | Consequence                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `appSecretsRef` unresolvable         | **the whole workspace is refused** (503). There is no safe degraded mode: the only one on offer is falling back to the fleet-wide `SECRET_KEY`, which is the silent default this piece exists to delete, and it _writes_ |
| `storage.credentialRef` unresolvable | **storage only** answers `503 Storage not configured`. The portal, roadmap, inbox and API keep working. Refusing a whole workspace because one bucket credential is unreadable turns a broken integration into an outage |

`isS3Configured()` (can a bucket be _addressed_) and `isS3Usable()` (can an
operation actually be _attempted_) stay separate, and every gate that touches the
bucket now asks the second. `getPublicUrlOrNull` returns **null** for a private
key it cannot sign rather than throwing, because an unsignable avatar should cost
one broken image and not every page that renders one.

#### The 500 that is now a 503

`GET /api/storage/*` gated on addressability and then called `getS3Config()`
**outside** its own try/catch, so a pooled workspace got HTTP **500 for every key**
— which is also why the isolation probe's P03 could not tell an accepted
signature from a refused one, and lost its verdict on top of the feature. The
gate now asks `isS3Usable()`, and `StorageUnavailableError` is caught explicitly
as a second barrier.

Proxy upload keeps two distinct refusals: `403` when this deployment does not do
proxy uploads at all (a permanent policy answer) and `503` when this workspace's
credentials do not resolve (a configuration outage an operator can fix).

#### `openbao+kv://` was narrowed before any of this shipped

The scheme validated traversal and nothing else, so
`openbao+kv://secret/platform/ai` — the fleet's own AI credential — was in policy
by the artifact's own rules. It was inert for exactly one reason: nothing could
dereference the scheme. Control-plane migration `0046` confines it to
`apps/<workspace>` **in its own migration, ahead of `0047`** which admits the two
new schemes; and no resolver for `openbao+kv://` ships here at all — every
resolver refuses it by name. Per-field policy now also stops a database
credential being expressible as an app-secret bundle and vice versa.

#### What is vendored, and why the digest matters more here

`vendor/fleet-secrets.ts` and `vendor/workspace-secret-resolution.ts` join
`contract.ts` and `secret-ref.ts` under the byte-for-byte digest check. The
stakes are higher than for the others: the control plane seals a value and a
fleet replica opens it, so drift is not a wrong answer, it is ciphertext nobody
can open. `__tests__/fleet-secrets.test.ts` additionally pins the derivation to
hardcoded vectors, because a digest cannot catch both copies being changed
_together_.

## 5. Background subsystems

About 25–35 files across ~15 subsystems run with no request scope. Under pooled
tenancy each needs an explicit answer, because `db` now throws rather than
guessing.

### Scoped

| Subsystem                                                                                                                                                                                                       | How                                                                                                                                                                              | Note                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All 10 periodic sweeps** — `audit_prune`, `invite_sweep`, `events_prune`, `logs_retention`, `summary_sweep`, `merge_sweep`, `changelog_notify`, `status_notify`, `status_maintenance_sweep`, `telemetry_ping` | `withSweepLock` fans a tick out across the fleet with a real workspace scope each time                                                                                           | One seam covers all ten; **no caller changed**. The lock needs no workspace segment because `sweep_lock` lives in the workspace's own database — so once `db` is scoped the lock is already per-workspace, which is exactly the semantics wanted                                                                 |
| **Startup OIDC backfill**                                                                                                                                                                                       | `runFleetPass`, and **only on a replica that already runs background work**                                                                                                      | A fleet-wide backfill on every web boot would open a connection to every workspace database and wake every suspended compute — precisely the cost the pooling exists to avoid                                                                                                                                    |
| **Readiness probe**                                                                                                                                                                                             | Probes the control store instead of a workspace database; stops asserting workspace schema state entirely                                                                        | §10.5. The old `migrationsKnownUpToDate` memo is actively misleading under pooling: it caches "migrations OK" forever after the first workspace it saw, going blind during exactly the rolling migration it exists to catch. Probing a workspace would also wake a suspended compute every few seconds           |
| **Anything holding a workspace id**                                                                                                                                                                             | `withWorkspaceScopeById(workspaceKey, origin, fn)`                                                                                                                               | Throws rather than degrading — a caller that named a workspace and got a different one has no safe fallback                                                                                                                                                                                                      |
| **The 15 background queues**                                                                                                                                                                                    | `jobs/tier.ts` runs one loop per workspace and opens a real workspace scope around every claim; `claimJobs` then re-asserts the claimed row's `workspace_key` against that scope | Both of these were refusals until the queues moved. The old in-process consumers carried no workspace on a job, so every processor resolved `db` with no scope and threw on its first query. A queue is now a table in the workspace's own database, so there is no shared queue to route out of. `jobs/JOBS.md` |
| **Event dispatch**                                                                                                                                                                                              | `emit()` writes an `event-dispatch` job in the same transaction; `jobs/tier.ts` drains it like any other queue                                                                   | `events/RELAY.md` (the outbox relay is gone) and `jobs/JOBS.md`                                                                                                                                                                                                                                                  |

`runFleetPass` is serial on purpose: running per-workspace sweeps concurrently would
wake every suspended compute at once. One workspace's failure never ends the pass —
a sweep that aborted the fleet because workspace 7 of 400 had a refused fingerprint
would turn one bad record into a fleet-wide outage of every sweeper.

### Deliberately refused, with the reason

| Subsystem                                      | Why not now                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `config.yaml` file watcher**             | One file at one path, and `ReconcileDeps` has no workspace parameter anywhere. You cannot mount N files at one path, so the trigger must be _replaced_ by a workspace-keyed entrypoint behind an authenticated control-plane route, not adapted (§8). Started under `single`, skipped under `pooled` with a log |
| **CLI backfill scripts**                       | Every one except `create-ci-api-key.ts` already builds its own `postgres()` from an explicit `DATABASE_URL`, so they are unaffected. `create-ci-api-key.ts` is the one on the proxy and needs a `--workspace` flag before it is used against a pooled fleet                                                     |
| **`bootstrap.ts`'s 10-second telemetry timer** | Starts a process-lifetime loop from inside the first HTTP request, so the timer fires after the request scope is gone. It lands in `withSweepLock` and is therefore scoped, but the shape — escaping a request scope via `setTimeout` — is worth removing rather than relying on                                |

### 5.1 The worker tier

`jobs/tier.ts`, started by `startup.ts` under `QUACKBACK_ROLE=worker` (or `all`).
One loop per workspace on that workspace's **direct**, session-mode endpoint,
each holding a `LISTEN quackback_job_wake` doorbell. Domain events no longer
have their own relay loop: `emit()` writes an `event-dispatch` job in the same
transaction as the outbox row. `events/RELAY.md` records the deletion;
`jobs/JOBS.md` is the account of the remaining tier.

**`LISTEN` through the pooler is impossible, not merely unreliable.** Measured
by **delivery**: pooled **0/1 across 16 runs**, 0/6, 0/10; direct 1/1, 6/6,
10/10. So the job doorbell must run on a session-mode connection.

**The corollary is a running cost, and it is why this is a separate service.**
An attached loop holds a session-mode socket with `idle_timeout: 0`. The detach
policy in `idle.ts` lets a quiet workspace go; a permanently attached listener
would keep the compute awake. That is the whole reason `quackback-worker` is
its own service rather than a role on the pooled tier: the pooled tier's
idle-cost model survives only if nothing in that process holds a connection
open while the workspace is idle.

### 5.2 The scheduled sweeps run on cron services, not on the worker

Every sweep in `startup.ts` funnels through `withSweepLock`, which under pooled
tenancy fans the tick out across the whole fleet. So a sweep's interval is the
rate at which every suspended compute is woken:

| Timer                                        | Interval | Against a ~337 s suspend timeout         |
| -------------------------------------------- | -------- | ---------------------------------------- |
| changelog / status / maintenance reconcilers | 5 min    | **no workspace ever suspends**           |
| billing reconcile                            | 15 min   | every workspace woken four times an hour |
| summary + merge sweeps                       | 30 min   | every workspace woken twice an hour      |
| kv sweep, telemetry claim                    | 1 h      | every workspace woken hourly             |

`startBackgroundProcessing()` therefore returns immediately after starting the
job tier when tenancy is pooled, and `cron/fleet-jobs.ts` holds the bodies so the
`deploy.cronSchedule` services and the single-workspace schedule run the same code.
The Postgres job tier and the boot-time partition ensure sit **above** that
return, because both run under either tenancy mode.

The cost, stated: the reconcilers go from 5-minutely, and the billing reconcile
from 15-minutely, to hourly on a pooled fleet. They are backstops behind a
synchronous publish, a delayed job and a provider webhook, so what lengthens is
the recovery window after a dropped delivery. Nothing changes for a single-workspace
install.

There is no outbox backstop among the cron jobs. `event-dispatch` is a job
queue row, so a lost NOTIFY costs a poll interval rather than an hour, and a
cron pass over every workspace's outbox would be a second drainer racing the
job claim.

### 5.3 `BASE_URL` is the workspace's, not the fleet's

`config.baseUrl` returns `getCurrentWorkspace()?.routing.baseUrl` whenever a workspace
scope is active. One getter rather than ~56 call sites, because a per-call-site
fix is a list that goes stale on the next absolute URL anyone writes. It reaches
email links, asset URLs, `__QUACKBACK_URL__` in the widget SDK, OAuth callback
redirects, the MCP resource metadata, better-auth's `baseURL` and the cookie
`secure` flag. `trustedOrigins` becomes the workspace's own hostnames and stops
honouring the process-wide `TRUSTED_ORIGINS`, which under pooling would make one
workspace's origin trusted on every other.

A wildcard `BASE_URL` is refused outright, in every tenancy mode: once a wildcard
custom domain is attached `RAILWAY_PUBLIC_DOMAIN` is the literal string
`*.example.com`, `new URL()` accepts it, and the only symptom is a dead link in a
customer's inbox.

### Known rough edge

`telemetry/instance-id.ts` wraps its whole body in a blanket `catch` that returns
a fresh random UUID. A scope-missing throw would therefore degrade silently into
a non-persisted id rather than surfacing. It is scoped now, so this does not
fire — but the swallow is worth narrowing.

---

## 6. Configuration

| Variable                                                | Meaning                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `QUACKBACK_TENANCY`                                     | `single` (default) or `pooled`                                                                             |
| `QUACKBACK_CONTROL_DATABASE_URL`                        | Control-plane Postgres holding `cp_workspace_registry` / `cp_workspace_hostnames`. Required under `pooled` |
| `DATABASE_URL`                                          | Required under `single`. **Refused under `pooled`**                                                        |
| `WORKSPACE_POOL_MAX` / `_MAX_ENTRIES` / `_IDLE_SECONDS` | See §4                                                                                                     |
| `WORKSPACE_REGISTRY_TTL_MS`                             | Hostname cache TTL                                                                                         |

**A pooled fleet refuses to boot with a `DATABASE_URL` set.** That is the
dangerous shape: a stray fleet-wide DSN means a missing workspace scope would
silently connect somewhere real instead of throwing. The `db` trap refuses
independently of the config check — two barriers, because this is the failure
that looks correct.

---

## 7. What is not done here

- **The ~20 workspace-scoped singletons of §4** are a separate piece. `workspace-keyed.ts`
  provides the two primitives they need (`workspaceKey` for external keys,
  `WorkspaceKeyedCache` for in-heap maps), and the single-workspace namespace is a
  stable `_` so self-hosted behaviour is unchanged.
- ~~**Per-workspace `SECRET_KEY` and S3 credentials.**~~ **Closed** — see §4. The
  requirements listed here were met as follows, with one deliberate deviation.

  **What the app requires of whoever closes it**, so the seam is not guessed at:

  | Requirement                                                     | How it was met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | One resolver, injected — not imported                           | **Deviated, deliberately.** `setStorageCredentialResolver()` was the wrong shape: it resolves one key, and the requirement two rows down asks for the whole bundle. It is replaced by `setWorkspaceSecretsResolver()`, which takes the `WorkspaceDescriptor` — a resolver that receives only a ref cannot check that the ref names the workspace whose record carries it, and that check is a real gate. The built-in resolver needs no client at all (local HKDF and local AEAD over a blob that arrived in the record), so the "no vault client" property holds by construction rather than by discipline. |
  | Resolve `appSecretsRef` **atomically with** `databaseUrl`       | Met literally rather than by convention: the sealed storage blob rides _in the ref_, so both halves are fields of the one row the DSN came from, resolved in one call against one descriptor.                                                                                                                                                                                                                                                                                                                                                                                                                |
  | Return the whole bundle, not one key                            | `resolveWorkspaceSecrets` returns `{secretKey, storage, storageProblem}` in one resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | Fail closed, and fail **loudly**                                | Two directions, chosen by cost — the workspace is refused when `SECRET_KEY` cannot resolve; storage alone degrades to 503 when its credential cannot. Neither substitutes a value. The `SECRET_KEY` refusal reaches the pool cache and evicts.                                                                                                                                                                                                                                                                                                                                                               |
  | Cache per workspace with a short TTL, and re-resolve on failure | 60 s TTL keyed by workspace **and `revision`**, dropped on any refusal so a retry re-resolves rather than re-failing on the value that was already wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
  | Never widen `openbao+kv://`'s target policy                     | Narrowed instead, in its own control-plane migration ahead of the one that admits the new schemes — and no resolver for the scheme ships at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

- **`MIN_SCHEMA_VERSION`.** §10.5 asks for a per-workspace schema gate in the same
  pass as the fingerprint, reading `workspace_schema_state`. That table belongs to
  the migrator piece; the hook point is `evaluateWorkspaceIdentity`'s caller, which
  already runs once per pool.
- **`EMAIL_INBOUND_SIGNING_SECRET`** is process-wide env. Inbound threading is off
  fleet-wide today, but under pooling one shared signing secret would let anyone
  forge a Reply-To into another workspace's conversation. It blocks enabling the
  email channel on a pooled fleet.
