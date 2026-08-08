# Pooled multi-tenancy

One process, many tenants, one Postgres database each, tenant decided per
request from the `Host` header.

This document states the resolution order, what happens on every failure mode,
how pool eviction is tuned and measured, and which background subsystems are
scoped versus deferred. Authority is `SAAS-HOSTING-STACK.md` §3, §5, §6, §7.3,
§8, §10.5; the data contract is `quackback-cp/docs/tenant-registry-contract.md`.

`QUACKBACK_TENANCY=single` is the default and is byte-for-byte today's
behaviour: one `DATABASE_URL`, one memoized connection, no registry, no
middleware work. Everything below applies to `pooled`.

---

## 1. Why this piece is unusual

If tenant resolution returns the wrong connection pool, **every RBAC and
permission check still passes.** That database's own `settings`, `principal` and
`roles` rows are entirely self-consistent, so authorization succeeds against the
wrong tenant's data. It does not error. It looks correct.

There is no second gate. So the design is arranged so that the only way to reach
a connection is through a record that is complete, valid, active *and*
fingerprinted, and so that the failure of any one of those is loud.

Two consequences run through every file here:

- **Absence is an error, never a default.** No fallback tenant, no fallback
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
  → state gate                     (active? suspended? deleting?)     ← no tenant DB touched yet
  → contract validation            (the vendored predicate, not a local reading)
  → pool acquire                   (LRU, keyed by tenant id, built or reused)
  → fingerprint assertion          (once per pool, three independent facts)
  → runWithTenantScope(...)        (AsyncLocalStorage)
  → CSRF, auth, and everything else
```

Registered in `start.ts` as `[requestContextMiddleware, tenantContextMiddleware,
csrfMiddleware]`.

**Tenant is resolved before auth, and that ordering is the piece.**
`middleware/request-context.ts` has always enriched `tenant_id` into the log
context *"once auth resolves"* — but auth resolution is itself full of
`db.query.*` calls, so that value lands long after the connection it was meant to
choose. Tenant resolution touches only the control database and completes before
any tenant-database query exists.

### Where the tenant lives once resolved

On the request-scoped `AsyncLocalStorage` store that `request-context.ts` already
opens for every SSR document, server route and server function, under a symbol
key — the same mechanism `functions/auth-request-cache.ts` already uses for its
per-request memo. `@quackback/logger` owns the store and shares it with
`@quackback/db` and `@quackback/email`, so a scoped log line carries `tenant_id`
without anyone passing it down.

`runWithTenantScope` always opens a **nested** ALS run rather than mutating the
enclosing store. Mutate-and-restore looks cheaper and is wrong: the body is
usually async, so a `finally` fires when the promise is *created*, not when it
settles, and the scope would vanish before the first query.

### The `db` Proxy

537 files import `db` from `@/lib/server/db`. **None of them changes.** The trap
resolves the handle on every property access; call sites never learn the
connection became per-request.

The trap did have a latent bug: it dropped the receiver, so `db.select(...)` ran
with `this === proxy`. That worked only because `getDatabase()` returned one
memoized singleton, so the re-entrant lookups resolved to the same object anyway.
A tenant-aware trap removes that accident, so function properties are now bound
to the handle they came from and `Reflect.get` is given that handle as the
receiver. The pattern already existed in-repo at
`__tests__/db-test-fixture.ts:59-62`.

---

## 3. Every failure mode

| Outcome | Status | Tenant DB touched | Notes |
| --- | --- | --- | --- |
| `ok` | serves | yes | |
| `unknown_host` — no registry record claims this hostname | **404** | no | Also the shape a port scan produces; cached briefly so it does not become a control-DB amplifier |
| `suspended` — record exists, gated off | **403** + reason | no | State is checked *before* validation, so suspending a tenant whose record is stale still reads as "suspended" rather than as corruption |
| `deleting` — teardown in flight | **410** | no | |
| `invalid` — a record exists but fails the contract | **503**, alert | no | Should essentially never fire: the control plane's write path refuses to commit a record its own reader would reject. If it fires, something edited the control database by hand or the reader is older than the writer |
| `refused` — the database is not the one the record named | **503**, alert | one query | §3's failure, caught |
| credential ref unresolvable | **503**, alert | no | Fails fast and by name (see below) |
| no tenant scope at all, in pooled mode | throws `TenantScopeMissingError` | no | The background-subsystem tripwire |

Every refusal is `Cache-Control: no-store`. A cached 404 or 503 on a shared edge
would pin a tenant into an outage long after its record was fixed.

**No refusal body carries operator detail.** The visitor gets "This workspace is
temporarily unavailable"; the log gets `REFUSED [workspace_id_mismatch]
settings.id is 019f…, expected 019f…`. Leaking the identifiers would be an
information leak about *another* tenant.

### The fingerprint: three independent facts

Checked once per pool, cached per pool, never per request.

| Fact | Written by | Beaten by |
| --- | --- | --- |
| `settings.id` | nobody — it is a primary key | a copy of the database |
| the control plane's stamp | the control plane, deliberately | a copy of the database |
| `neon.branch_id` (a GUC) | the platform, per compute | nothing we can reach |

`settings` is exactly one row per database — the app's own `requireSettings()` is
a `findFirst()` with no `WHERE` clause — which is what makes the database the
tenant boundary in the first place. Anything other than exactly one row is a
refusal.

The first two are decided by `evaluateFingerprint`, **vendored byte-for-byte**
from the control plane into `vendor/contract.ts`. It is copied rather than
paraphrased because two repos independently reading the same prose is exactly how
one of them ends up with a slightly more forgiving version, and the forgiving one
is the one that serves the wrong tenant. `__tests__/vendor-parity.test.ts` guards
the copy with a committed digest (always runs) *and* a direct comparison against
the control-plane checkout (runs when one is present — a skipped check reports
success, which is why it is not the only check).

**The third fact exists because a Neon branch is indistinguishable from its
parent by the first two.** Branching is copy-on-write, so a branch carries a
byte-identical `settings.id` and a byte-identical stamp. That matters more than
it first appears: branching is exactly what §10.8 recommends for migration
preflight, so *the most likely operational mistake is the one the content
fingerprint cannot catch.* Neon publishes `neon.project_id`, `neon.branch_id` and
`neon.endpoint_id` as GUCs — properties of the compute, not of the data —
readable identically through the pooled and direct endpoints. Read with
`current_setting(name, true)` so plain Postgres yields NULL instead of raising.
A record that *claims* a Neon branch and reaches a database that cannot name one
is refused; a record claiming no Neon placement skips the check.

Demonstrated live, 2026-08-08, against the gauntlet tenants:

```
t1 record → t2's database    HTTP 503   REFUSED [workspace_id_mismatch]
                                        settings.id is 019fe1d3-…, expected 019fe1ca-…
t1 record → a BRANCH of t1   HTTP 503   REFUSED [neon_branch_mismatch]
                                        neon.branch_id is br-tiny-bird-…, expected br-weathered-lake-…
t1 record → t1              HTTP 200
```

The branch case is the one that used to pass.

### Where the stamp is read from

Preferentially from **`settings.cloud_tenant_id`**, a dedicated column
(migration `0251`). The stamp's original home is the `settings.metadata` JSON
bag, and `telemetry/instance-id.ts` performs an unlocked, unattended **hourly**
read-modify-write of that same bag which never invalidates the settings cache —
so it can interleave with a stamp write and drop it. A column removes the class
rather than narrowing the window.

The column is read through `to_jsonb(s) ->> 'cloud_tenant_id'` rather than by
name, so the query still runs against a database that predates `0251` and simply
reports the column absent. That matters because the fingerprint is the *first*
thing a pooled process does with a tenant database, and refusing to look because
of a migration-ordering problem would turn an expand-only migration into an
outage. When both sources are present and disagree, that is its own refusal
(`stamp_source_conflict`) — two writers claiming different owners is not a state
to pick a winner from.

**`cloud_tenant_id` is deliberately NOT added to the Drizzle schema.** The app
never reads or writes it; only the raw fingerprint query does. Adding it to the
ORM would make every `settings` select in the app emit the column name, so every
tenant that had not yet run `0251` would fail on *unrelated* reads — a real cost
for a column the app has no use for. §5's ordering rule (expand lands before the
code that reads it) is respected by not creating the dependency at all.

---

## 4. Pool management

An LRU of `postgres()` pools keyed by tenant id.

| Knob | Default | Why |
| --- | --- | --- |
| `TENANT_POOL_MAX` | 3 | One instance holds N tenant pools and the Neon pooler multiplexes anyway; 10 per tenant would be N×10 sockets for no throughput |
| `TENANT_POOL_MAX_ENTRIES` | 50 | LRU cap per instance |
| `TENANT_POOL_IDLE_SECONDS` | 45 | See below — this is the number the cost model rests on |
| `TENANT_REGISTRY_TTL_MS` | 30 000 | Hostname → record cache; `revision` invalidates within the window |

Pools terminate at the **pooled** (transaction-mode) endpoint. The direct
endpoint is reserved for session-mode consumers — `LISTEN`, `pg_advisory_lock`,
`CREATE INDEX CONCURRENTLY` — which is why the record carries both.

`prepare: true` is kept. Protocol-level prepared statements are verified safe
through the Neon pooler under real backend reassignment. The boundary is that
Drizzle emits explicit column lists; hand-written `SELECT *` in a
migration-adjacent path would break it.

### Credential rotation

`postgres.js` accepts a **function** for `password` and calls it on every new
connection, so a rotated credential is picked up by reconnecting rather than by
wedging: existing sockets keep working, the next one resolves fresh. `dbRole` is
a first-class field on the record for exactly this reason. `neon+role://` refs
are dereferenced through Neon's `reveal_password` with a 60-second memo — long
enough that a burst of pool creations does not fan out into N management-API
calls, short enough that a rotation is picked up without an operator action.

The credential is additionally resolved **once, eagerly, before the first
connection** — not for caching, but for the error. A password provider that
throws is swallowed by the driver and re-reported as `CONNECT_TIMEOUT` fifteen
seconds later, which is both slow and names the wrong cause.

### Eviction is the cost model, not memory hygiene

Neon suspends a compute when **no client is connected**. An open pool holds the
database awake, so eviction is the single thing that makes an idle tenant cost
storage only (~$0.02/month) instead of running compute indefinitely. The same
silence is what lets a Railway `role=web` service sleep, since Railway's rule
triggers on ten minutes without an *outbound* packet.

So `TENANT_POOL_IDLE_SECONDS` must sit comfortably below **both** Neon's
`suspend_timeout_seconds` (300 s default, and not editable on every plan) and
Railway's 600 s window. 45 s is the default; the gauntlet measurement ran at 20 s.

Two layers do the work. `postgres.js` closes idle *sockets* after `idle_timeout`,
which is what actually lets the compute suspend. A sweep additionally drops the
pool object, which stops a tenant routed here once from holding an LRU slot
forever and makes the eviction counter meaningful.

**Measure it; do not reason about it.** Get this wrong and every tenant ever
routed to an instance stays awake forever — silently, with **no functional
signal at all**. That absence of symptom is why `getPoolCacheStats()` exposes
`evicted`, `evictedByReason` and `evictionsPerHour` as first-class counters
rather than debug logs: the counter is the only thing that distinguishes
"working" from "quietly costing money".

**Eviction is necessary but not sufficient.** Under `QUACKBACK_ROLE=all` the
outbox relay issues `SELECT … FROM events WHERE published_at IS NULL` every
second, forever, so the compute never suspends whatever this cache does. Idle
saving requires `QUACKBACK_ROLE=web`. The role split is not an optimisation for
the worker tier; it is the precondition for any Neon idle saving whatsoever.

#### Measured, 2026-08-08

Local pooled fleet, `QUACKBACK_ROLE=web`, `TENANT_POOL_IDLE_SECONDS=20`, against
`gauntlet-neon-t3` (its own Neon project, 0.25 CU, default 300 s suspend). The
method polls the Neon API for `current_state = idle` **before** the trial: a
suspend/wake measurement without a verified pre-state measures nothing.

| Step | Observed |
| --- | --- |
| verified pre-state | `idle` |
| cold request (`GET /api/widget/config.json`, Host `t3.localhost`) | HTTP **200 in 3 s** — Neon wake + first pool build + fingerprint + render, all cold |
| state immediately after | `active` |
| pool evicted | **+25.2 s** after last use, `reason: idle`, socket closed (20 s threshold, swept every ~6.7 s) |
| compute returned to `idle` | **+337 s** after last traffic, polled every 15 s |

337 s against a documented 300 s `suspend_timeout_seconds`, of which the first
~25 s is the pool still holding a socket open. So the compute suspended roughly
312 s after the connection actually closed — consistent with the 306–309 s
time-to-suspend measured independently elsewhere in this run, and it confirms the
causal claim rather than merely the correlation: **the compute suspends because
the pool let go.**

Open question 2 of `SAAS-HOSTING-STACK.md` ("does pool eviction actually let Neon
suspend?") is answered yes — under `QUACKBACK_ROLE=web`, and only under it.

---

### Running the isolation probe against this fleet

`apps/web/tenancy-probe/` is the instrument this piece exists to satisfy. Two
things about running it here are not obvious and cost a full run each:

**Tear the fixture down between orderings.** The suite derives its canaries from
the *slot* (`alpha`/`bravo`) while its fixture is find-or-create against a
stable slug and therefore persists per *tenant*. Boards are never rewritten;
posts are. So re-running with the tenant↔slot mapping swapped leaves each tenant
holding the previous run's slot canary, and the suite reads that as the other
tenant's data — in both directions, symmetrically, with nothing having crossed.
And **`--teardown` is not sufficient**: it removes the fixture the *current*
configuration names, so rows created under a different tenant↔slot mapping
survive it and accumulate. After three runs each tenant held two boards and two
posts, each carrying whichever slot canary it held when that row was written,
and P07 reported a LEAK in both directions from it.

The check that separates accumulation from a real leak is **row identity, not
canary counts**: a cross-tenant write puts the same row id in both databases.
Accumulation leaves every id distinct, each created locally. Verified here —
zero overlap, and `settings.name` (planted per tenant and never rotated) stayed
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
  says *"there is no filter that can record a signal without counting it"*, and
  for P03 that is not true: it returns through an early `error()` that bypasses
  `decide()`, so a control class the suite maps to `LEAK` surfaces as `ERROR` —
  exit 1, not 2. **The same early-return shape appears in 7 of the 9 probes.** A
  clean exit code is therefore weaker evidence than the README implies; read the
  per-control detail.
- **P03's inferred capability no longer exists.** It infers a cross-tenant read
  from one shared storage secret, but `storageReadSig` now signs
  `tenantBind('read|<key>')`, so a capability minted for one tenant does not
  verify on another *even on a single shared secret*. The suite cannot see that,
  and `crypto-drift.test.ts` cannot either, because it runs unscoped and
  `tenantBind` preserves the unscoped message byte-for-byte — which is exactly
  the property that keeps self-hosted installs unchanged.

### The surface the isolation probe cannot judge

The Piece 1 probe suite's own README records `/api/widget/config.json` as
unguarded for any tenant on a greyscale or default brand colour: the planted
identity token lives in the workspace name or the portal welcome headline, and
that surface carries neither — only colours. So it was checked directly, on the
live pooled fleet, with a positive control on every assertion.

Two tenants were given distinct brand colours through custom CSS (the path
`extractThemeFromCss` actually reads) and the shared settings cache was dropped
between orderings:

| Order | Result |
| --- | --- |
| cold, alpha first | PASS — each host served **its own** colour, neither served the other's |
| cold, bravo first | PASS |
| six alternating requests, then re-read both | PASS |

The ordering matters and is not decoration. A cache that is last-writer-wins is
asymmetric: testing one direction leaves detection to whichever tenant's value
happened to survive, which is a defect class this run has already been bitten by.

**The positive control is the load-bearing part.** A first pass of this check
reported PASS on every surface while *neither* host served its own marker at all
— both tenants were freshly provisioned and redirected to `/onboarding`, so the
bodies were identical and empty of identity. An "isolation" result from a surface
that renders no identity is not a result. The check now reports `ERROR` rather
than `PASS` whenever a host fails to serve its own marker.

---

### Storage does not work under pooled tenancy

Stated plainly rather than left as an inference from a stack trace: **every
storage operation fails for a pooled tenant, and the reason is a single missing
piece.** `resolveStorageCredentials()` throws whenever a tenant scope is active
and no credential resolver has been registered, and it throws *before* the
proxy cache is consulted — so `/api/storage/*` returns an error for every key,
which is also why no cross-tenant cache hit could be produced there even though
the underlying defect was real.

**The attribution, precisely:**

| Part | Whose |
| --- | --- |
| No resolver exists for the `openbao+kv://` credential ref the registry carries | **The per-tenant app-secret resolver piece.** Not closable here; see §7 for the six requirements the app has of it |
| The two upload gates asked whether a bucket was *addressable*, not whether storage was *usable* | **Mine, fixed.** A tenant record always names a bucket, so the addressability question answers `true` while every upload throws. `isS3Configured()` keeps that meaning — `buildPublicUrl` needs a placement and no credentials, and a public asset URL must keep resolving for a tenant this process cannot dereference — and `isS3Usable()` is the new question the upload gates ask. A first attempt collapsed the two and three placement tests caught it |
| The failure surfaces as an unhandled 500 rather than a typed refusal | **Mine, open.** It is a configuration state, not a crash. It is why P03 reports `expected 403 but got 500 — the probe cannot distinguish an accepted signature from a refused one`, so it costs a probe family its verdict on top of the feature |

Until the resolver lands, a pooled fleet has no working uploads, no asset proxy
and no presigned URLs. That is a larger statement than "P03 is blocked" and it
belongs in front of anyone who reads this file.

## 5. Background subsystems

About 25–35 files across ~15 subsystems run with no request scope. Under pooled
tenancy each needs an explicit answer, because `db` now throws rather than
guessing.

### Scoped

| Subsystem | How | Note |
| --- | --- | --- |
| **All 10 periodic sweeps** — `audit_prune`, `invite_sweep`, `events_prune`, `logs_retention`, `summary_sweep`, `merge_sweep`, `changelog_notify`, `status_notify`, `status_maintenance_sweep`, `telemetry_ping` | `withSweepLock` fans a tick out across the fleet with a real tenant scope each time | One seam covers all ten; **no caller changed**. The lock needs no tenant segment because `sweep_lock` lives in the tenant's own database — so once `db` is scoped the lock is already per-tenant, which is exactly the semantics wanted |
| **Startup OIDC backfill** | `runFleetPass`, and **only on a replica that already runs background work** | A fleet-wide backfill on every web boot would open a connection to every tenant database and wake every suspended compute — precisely the cost the pooling exists to avoid |
| **Readiness probe** | Probes the control store instead of a tenant database; stops asserting tenant schema state entirely | §10.5. The old `migrationsKnownUpToDate` memo is actively misleading under pooling: it caches "migrations OK" forever after the first tenant it saw, going blind during exactly the rolling migration it exists to catch. Probing a tenant would also wake a suspended compute every few seconds |
| **Anything holding a tenant id** | `withTenantScopeById(tenantId, origin, fn)` | Throws rather than degrading — a caller that named a tenant and got a different one has no safe fallback |

`runFleetPass` is serial on purpose: running per-tenant sweeps concurrently would
wake every suspended compute at once. One tenant's failure never ends the pass —
a sweep that aborted the fleet because tenant 7 of 400 had a refused fingerprint
would turn one bad record into a fleet-wide outage of every sweeper.

### Deliberately refused, with the reason

| Subsystem | Why not now |
| --- | --- |
| **The 15 BullMQ workers** | A job carries no tenant, so every processor would resolve `db` with no scope and throw on its first query. A per-job failure is a far worse signal than one loud refusal at boot, so the tier does not start under pooled tenancy and says so. Per-tenant job routing belongs with the Postgres-queue work |
| **The outbox relay** | Needs a session-mode connection for `LISTEN` and `pg_advisory_lock`. Through a transaction pooler the registration is lost *in proportion to contention*, so a single-client smoke test passes while a busy fleet silently stops receiving wakes. It needs per-tenant **direct** connections on a separate always-warm tier (§7.3) — and note the corollary: that tier holds its connections open by design, so it must never share a compute with tenants you expect to suspend |
| **The `config.yaml` file watcher** | One file at one path, and `ReconcileDeps` has no tenant parameter anywhere. You cannot mount N files at one path, so the trigger must be *replaced* by a tenant-keyed entrypoint behind an authenticated control-plane route, not adapted (§8). Started under `single`, skipped under `pooled` with a log |
| **CLI backfill scripts** | Every one except `create-ci-api-key.ts` already builds its own `postgres()` from an explicit `DATABASE_URL`, so they are unaffected. `create-ci-api-key.ts` is the one on the proxy and needs a `--tenant` flag before it is used against a pooled fleet |
| **`bootstrap.ts`'s 10-second telemetry timer** | Starts a process-lifetime loop from inside the first HTTP request, so the timer fires after the request scope is gone. It lands in `withSweepLock` and is therefore scoped, but the shape — escaping a request scope via `setTimeout` — is worth removing rather than relying on |

### Known rough edge

`telemetry/instance-id.ts` wraps its whole body in a blanket `catch` that returns
a fresh random UUID. A scope-missing throw would therefore degrade silently into
a non-persisted id rather than surfacing. It is scoped now, so this does not
fire — but the swallow is worth narrowing.

---

## 6. Configuration

| Variable | Meaning |
| --- | --- |
| `QUACKBACK_TENANCY` | `single` (default) or `pooled` |
| `QUACKBACK_CONTROL_DATABASE_URL` | Control-plane Postgres holding `cp_tenant_registry` / `cp_tenant_hostnames`. Required under `pooled` |
| `DATABASE_URL` | Required under `single`. **Refused under `pooled`** |
| `NEON_API_KEY` | Dereferences `neon+role://` credential refs |
| `TENANT_POOL_MAX` / `_MAX_ENTRIES` / `_IDLE_SECONDS` | See §4 |
| `TENANT_REGISTRY_TTL_MS` | Hostname cache TTL |

**A pooled fleet refuses to boot with a `DATABASE_URL` set.** That is the
dangerous shape: a stray fleet-wide DSN means a missing tenant scope would
silently connect somewhere real instead of throwing. The `db` trap refuses
independently of the config check — two barriers, because this is the failure
that looks correct.

---

## 7. What is not done here

- **The ~20 tenant-scoped singletons of §4** are a separate piece. `tenant-keyed.ts`
  provides the two primitives they need (`tenantKey` for external keys,
  `TenantKeyedCache` for in-heap maps), and the single-tenant namespace is a
  stable `_` so self-hosted behaviour is unchanged.
- **Per-tenant `SECRET_KEY` and S3 credentials.** The registry carries
  `appSecretsRef` and `storage.credentialRef` as `openbao+kv://` references, and
  this process has no OpenBao resolver. Until it does, a pooled fleet shares the
  fleet-level `SECRET_KEY` — which does not silently corrupt or forge anything
  (AES-GCM fails closed) but does mean per-tenant encrypted material is not yet
  separated. This must close before the pooled fleet serves anything real.

  **What the app requires of whoever closes it**, so the seam is not guessed at:

  | Requirement | Why |
  | --- | --- |
  | One resolver, injected — not imported | `setStorageCredentialResolver()` is the existing seam; the app must stay free of a vault client so a process that serves no cloud tenant needs no vault credentials, exactly as `readNeonRolePassword` is injected today. |
  | Resolve `appSecretsRef` **atomically with** `databaseUrl` | §4.3. They are already one record read once, and that is what makes a mix-up inexpressible. A resolver that fetches the secret on a later, separate call reintroduces the window. |
  | Return the whole bundle, not one key | `appSecretsRef` names `SECRET_KEY`, `ADMIN_API_TOKEN`, `QUACKBACK_CP_INTERNAL_TOKEN` and the S3 keys together. Splitting them into per-key fetches multiplies the failure modes and the latency on the pool-checkout path. |
  | Fail closed, and fail **loudly** | A `SECRET_KEY` mix-up does not corrupt or forge — AES-GCM's auth tag fails to verify — but it makes integration OAuth tokens, webhook signing secrets and custom-action headers *permanently unrecoverable* until the right key returns, with no alarm beyond scattered per-call errors. The resolver must refuse rather than substitute, and the refusal must reach the pool cache so the tenant stops being served. |
  | Cache per tenant with a short TTL, and re-resolve on failure | Same shape as `neon-credentials.ts`: a burst of pool creations must not fan out into N vault reads, and a rotation must be picked up without an operator action. |
  | Never widen `openbao+kv://`'s target policy | The scheme blocks traversal but has **no namespace confinement** today, so `openbao+kv://secret/platform/ai` is in-policy by the artifact's own rules. Tighten that *before* a resolver ships, not after — a resolver is what makes it reachable. |
- **`MIN_SCHEMA_VERSION`.** §10.5 asks for a per-tenant schema gate in the same
  pass as the fingerprint, reading `tenant_schema_state`. That table belongs to
  the migrator piece; the hook point is `evaluateTenantIdentity`'s caller, which
  already runs once per pool.
- **`EMAIL_INBOUND_SIGNING_SECRET`** is process-wide env. Inbound threading is off
  fleet-wide today, but under pooling one shared signing secret would let anyone
  forge a Reply-To into another tenant's conversation. It blocks enabling the
  email channel on a pooled fleet.
