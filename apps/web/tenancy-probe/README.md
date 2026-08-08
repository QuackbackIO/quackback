# Tenant isolation probe

An adversarial two-tenant probe suite. It provisions two synthetic tenants with
deliberately colliding data, then actively attempts cross-tenant access and
asserts that every attempt **fails closed** — a loud, distinguishable refusal,
never a plausible-looking wrong answer.

## Why this exists

From `SAAS-HOSTING-STACK.md` §3, on pooled multi-tenancy:

> If tenant resolution ever returns the wrong connection pool, **every RBAC and
> permission check still passes**, because that database's own `settings`,
> `principal` and `roles` rows are entirely self-consistent. It does not error.
> It looks correct.

Nothing throws, so ordinary tests are useless. Two design decisions follow.

**Every probe carries a positive control.** "Bravo refused alpha's credential"
is worthless until "alpha's credential works on alpha" has been proven in the
same run. Without that, an unreachable host, a revoked key or a typo'd URL all
score as perfect isolation. When a positive control fails the probe reports
`ERROR` and says so — it never reports `PASS`.

**One shared rule turns controls into verdicts.** Every check a probe makes is
classified, and `decide()` in `probes/helpers.ts` maps the classification to the
verdict for all nine probes:

| Kind         | Meaning                                                      | Failure becomes |
| ------------ | ------------------------------------------------------------ | --------------- |
| `positive`   | the mechanism works inside its own tenant                    | `ERROR`         |
| `negative`   | the adversarial cross-tenant attempt                         | `LEAK`          |
| `invariant`  | a config fact whose violation _is_ a cross-tenant capability | `LEAK`          |
| `visibility` | the probe's ability to observe at all                        | `ERROR`         |

This is centralized deliberately. An earlier version let each probe pick its own
failing controls with a local filter, and one of those filters dropped
`invariant` failures from the decision — so a probe could observe a shared
secret, record it, print it, and still return `PASS`. Classifying a control is
now the whole of a probe's verdict logic; there is no filter that can record a
signal without counting it.

**A marker must be able to accuse.** A string only means something if its
appearance in the other tenant's output has no innocent explanation. Two filters
stand between a stored value and a verdict (`vocabulary.ts`): tokens that could
appear in any tenant's output are never admitted (greys and near-universal
colours, short strings, names built entirely from common product vocabulary, and
anything this suite's own fixture writes into both tenants), and an admitted
token only accuses when the host serving it shows **none of its own identity**
on that surface. A host rendering its own name alongside a word that happens to
also be in the other's settings is plainly rendering itself.

**Every cross-tenant attempt is made in both directions.** Every `negative`
control declares its direction and a test asserts both are covered. This is not
tidiness: an email-keyed credential stash is last-writer-wins, so testing one
direction leaves detection to whichever tenant's value happens to survive.

**Every response is scanned for the other tenant's markers.** Probes assert on
what they attacked; the tripwire catches what the probe author did not think to
check. Its vocabulary is per-tenant canary strings plus tenant-unique TypeIDs,
which cannot collide. A tripwire hit overrides a probe's own `PASS`.

## The colliding fixture

Both tenants are given identical human-readable data on purpose:

| Field             | Value (both tenants)                 |
| ----------------- | ------------------------------------ |
| Admin address     | `admin@example.com`                  |
| Board name / slug | `Feature Requests` / `tenancy-probe` |
| Post title        | `Dark mode`                          |
| Widget visitor    | `probe-visitor@example.com`          |

Only two things differ: a per-tenant canary token in the post and board body
(`qbprobecanaryalpha` / `qbprobecanarybravo`) and the row ids. That is the whole
point — a wrong-tenant answer is indistinguishable from a right one on every
field a naive assertion would look at.

The suite refuses to run if the collision is absent, if the canaries or ids match
across tenants, or if both URLs resolve to the same workspace. Each of those
would make a `PASS` meaningless.

Provisioning is find-or-create against stable slugs, so running twice leaves the
same state and returns the same verdict.

## Running it

```bash
bun apps/web/tenancy-probe/cli.ts \
  --alpha http://alpha.localhost:3000 \
  --bravo http://bravo.localhost:3000 \
  --alpha-api-key qb_… --bravo-api-key qb_…
```

Point it at a deployed fleet by changing nothing but the two URLs:

```bash
bun apps/web/tenancy-probe/cli.ts \
  --alpha https://alpha.example.com --bravo https://bravo.example.com \
  --alpha-api-key "$ALPHA_KEY" --bravo-api-key "$BRAVO_KEY" \
  --json-out isolation-report.json
```

`bun apps/web/tenancy-probe/cli.ts --help` lists every flag. Each has an
environment-variable equivalent (`ALPHA_BASE_URL`, `ALPHA_API_KEY`,
`ALPHA_DATABASE_URL`, `ALPHA_S3_SECRET_ACCESS_KEY`, `ALPHA_WIDGET_SECRET`, and
the `BRAVO_` twins) so CI can pass secrets without putting them in argv.

**Output.** The JSON report goes to stdout (or `--json-out <path>`); the human
summary and progress logging go to stderr. `... | jq` therefore works unmodified,
and a leak stays legible when the JSON is piped away.

**Exit codes.**

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | every probe passed                                               |
| `1`  | a probe could not execute (`ERROR` or `BLOCKED`); nothing leaked |
| `2`  | a cross-tenant observation was made                              |

`--allow-blocked` makes `BLOCKED` non-fatal **for the exit code only**. The JSON
`verdict` still reads `FAIL`, and `exitTolerates` records what was waived — a CI
check keyed on `verdict` must never read green while probes did not run. It
never makes a `LEAK` or an `ERROR` pass, and blocked probes are still listed
first in the summary.

`--only` restricts the run to named probes. A filtered run sets `partial: true`
and lists `filteredOut` in the JSON, so a consumer reading `verdict: "PASS"`
never has to parse the human summary to learn that six probes did not run.

The report never contains a credential. The widget signing secret is a marker
the tripwire scans for — a signing secret appearing in a response body is among
the worst findings available — but it is held separately from the reportable
markers, redacted in any hit, and stripped from the JSON.

`--teardown` removes the fixture from both tenants.

### Inputs and what they unlock

Only the two URLs and the two API keys are needed to run. Everything else widens
coverage, and a probe whose inputs are missing reports `BLOCKED` with the exact
flag to pass — never a silent skip.

| Input                                               | Unlocks                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `--alpha` / `--bravo`                               | reachability, and every HTTP probe                                                             |
| `--alpha-api-key` / `--bravo-api-key`               | **fixture provisioning** (required), P05                                                       |
| `--admin-email` / `--admin-password`                | P01, P02 (defaults `admin@example.com` / `password`)                                           |
| `--alpha-db` / `--bravo-db`                         | P02, P07, P09, and the row-level scans in P06/P08. Also reads the widget secrets automatically |
| `--alpha-storage-secret` / `--bravo-storage-secret` | P03                                                                                            |
| `--alpha-widget-secret` / `--bravo-widget-secret`   | P04 (or supply the database URLs)                                                              |

## The probes

| Id      | Family    | What a `PASS` proves                                                                                                                                                                                                                     |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P01** | session   | A session minted by alpha authenticates nothing on bravo — not as a cookie, not as a raw Bearer token, and not on an authenticated SSR document.                                                                                         |
| **P02** | session   | A magic-link token or sign-in OTP minted by one tenant establishes no session on the other, _while the other tenant holds its own live credential for the identical address_, and each tenant's own credential resolves to its own user. |
| **P03** | storage   | A private-object read capability minted with one tenant's storage secret is refused by the other for the identical object key — i.e. the tenants do not share a storage secret.                                                          |
| **P04** | widget    | A widget SSO token signed with one tenant's widget secret mints no session in the other, and a widget session token issued by one resolves to no user in the other.                                                                      |
| **P05** | api       | A REST API key issued by one tenant is rejected with 401 by the other, and returns neither the issuer's rows (wrong pool) nor the target's (wrong credential accepted).                                                                  |
| **P06** | cache     | Settings-derived public surfaces read in a tight interleave never serve one tenant's workspace identity, branding or configuration under the other's hostname.                                                                           |
| **P07** | jobs      | A write driven on alpha produces derived background rows in alpha's database and none at all in bravo's.                                                                                                                                 |
| **P08** | read      | No public surface on bravo returns a row, id or canary belonging to alpha — including a search for a title that exists identically in both tenants.                                                                                      |
| **P09** | assistant | Each tenant's assistant service principal is its own row, and neither database contains a reference to the other's principal id, in TypeID or uuid form.                                                                                 |

Two constructions are worth calling out because they are what make the probes
sensitive rather than ceremonial.

**P02 makes both tenants hold a live credential for the same address before
attempting any cross-redemption.** Otherwise "bravo refused alpha's token" is
explained by "bravo has no such row" — the trivial case. With a live row present
for that exact address, bravo must refuse a token it did not itself mint.

**P06 derives its vocabulary from what each tenant has stored, not from what
the probe expects to find.** An earlier version searched served responses for
the workspace slug and the workspace TypeID and could not see a settings-cache
leak at all, because neither string is present in what leaks:
`/api/widget/config.json` carries theme colours, tabs and flags and no
identifier whatsoever, and the portal document carries the workspace _name_. The
probe now reads `name`, `slug`, id, `branding_config`, `custom_css`,
`portal_config` and `widget_config` from each tenant's settings row, reduces
them to the tokens **exclusive** to one tenant, and asserts neither host ever
serves the other's. Stability across the interleave is measured on those tokens
rather than on raw bytes, so a CSP nonce or a timestamp cannot manufacture a
false `LEAK`.

**P03 uses the same object key against both tenants.** A signature is bound to
its key, so signing alpha's key and presenting it for bravo's key would be
refused by arithmetic rather than by isolation. Holding the key constant isolates
the only variable that matters: the secret. The object need not exist — the
handler verifies the capability before it touches storage, so a rejected
signature is a clean 403 and an accepted one falls through to the object path.

## What is not fully exercisable today

The pooled architecture does not exist yet. Today `alpha` and `bravo` are two
separate processes, with separate `SECRET_KEY`s, separate Redis instances and
separate databases. Several probes therefore pass today for a stronger reason
than the one they are designed to test — the failure mode is not merely absent,
it is unreachable.

Each affected probe carries a `poolingCaveat`, printed in the summary next to its
`PASS` and present in the JSON, so this can never be read as a clean bill of
health for pooled compute.

| Probe   | Why today's pass is weaker than it looks                                                                                                                                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P01** | Two processes, two signing keys, two `session` tables — a refusal is over-determined. The real target is the memoised better-auth instance behind `_authConfigVersion` (`auth/index.ts:78`), a small monotonic per-tenant integer whose values can coincide. Only reachable once one process serves both tenants. |
| **P02** | The in-process `magicLinkStash` / `otpStash` (`auth/index.ts:29-51`) are keyed by lowercased email alone. They can only collide inside one process. Today the probe exercises the database-backed `verification` path only.                                                                                       |
| **P06** | `redis.ts` `CACHE_KEYS` are bare literals (`settings:tenant`, `auth:registered-providers`, …). They collide only when one Redis is shared. Today the probe confirms the surfaces are distinguishable and self-consistent — the collision itself is not yet reachable.                                             |
| **P07** | Each tenant runs its own worker bound to one `DATABASE_URL`, so a job physically cannot reach the other database. Today the probe establishes the observation baseline and proves the scan can actually see derived rows.                                                                                         |
| **P09** | `memoizedAssistantPrincipalId` (`assistant.orchestrator.ts:62`) is process-scoped and can only be poisoned once one process serves both tenants. Today the probe proves the two ids are distinct and unreferenced.                                                                                                |

P03, P04, P05 and P08 are fully meaningful today: they test secrets, credentials
and query scoping that are already shared-or-not regardless of process topology.
P03 in particular directly tests the property §9 relies on to justify
bucket-per-tenant.

Two further gaps, stated plainly:

- **Presence signals are covered only at the row level.** P08 scans bravo's
  database for alpha's markers, which catches persisted presence, but it does not
  open an SSE stream and watch for a cross-tenant presence event. The Redis
  `AGENTS_ZSET = 'conversation:presence:agents'` key named in §7.4 is untenanted
  and is not yet directly probed.
- **P06 cannot see a cache that is shared but not observable.** It reads the
  public surfaces that settings feed; a cached value with no public projection
  (webhook rows, registered auth providers) is out of its reach over HTTP.

## Self-tests

```bash
bun run test   # or: bunx vitest run apps/web/tenancy-probe
```

`__tests__/leak-detection.test.ts` is the important one. It plants each hazard
into an in-process two-tenant fleet — shared session store, shared storage
secret, shared API keys, shared search index, shared widget secret, shared
settings cache — and asserts the matching probe reports `LEAK`, that the clean
fleet reports `PASS`, and that a misconfigured or unreachable target reports
`ERROR`. A suite that only ever ran against a correct system would be validated
against the one case where every possible implementation passes.

`__tests__/crypto-drift.test.ts` pins the two tokens the harness mints for itself
against the real verifiers imported from the app. `storageReadSig` is
module-private in `lib/server/storage/s3.ts`, so the harness re-implements it; if
the server's construction ever changes, the minted token would be malformed,
every cross-tenant attempt would be refused for the wrong reason, and the probe
would report a false `PASS`. This makes that drift break `bun run test` instead.

`__tests__/end-to-end.test.ts` drives the real `runSuite → report → exit code`
path against a planted fleet, rather than calling `probe.run()` directly. It
tests **both poles**: alongside each planted leak it runs correct fleets built
specifically to trip the identity vocabulary — a workspace whose CSS contains an
ordinary `#ffffff`, a workspace named `Support` that the other tenant's own
navigation renders, and a workspace named after the board this suite creates in
both tenants. All three must exit 0, and a real leak on a generically-named
fleet must still exit 2. It also runs a shared credential stash under **both**
write-order polarities. This
is the file that matters most, and it exists because probe-level tests were not
enough: three defects survived an earlier sensitivity pass — P02 could never
execute at all, P07's blind guard was satisfied by fixture data, and P06 reported
`PASS` on the leak it was written to catch — and two of those probes were never
imported by a test. Every case here asserts on the report and the exit code,
including that a clean run and a leaking run do not produce identical output,
and that a per-request nonce does not manufacture a `LEAK`.

`__tests__/tripwire.test.ts` covers both tripwire failure modes: missing a real
marker, and flagging the harness's own echo. It also pins `markerSearchForms`,
which expands a TypeID into its uuid form — entity ids are `uuid` columns in
Postgres, so a database scan for the TypeID string alone matches nothing and
would always look clean.

`__tests__/scan-tables.test.ts` pins `SCAN_TABLES` against the real Drizzle
schema. A misspelled table name narrows every row-level scan in complete
silence; the list carried `notifications`, which does not exist. At runtime
`scanCoverage` additionally fails a `visibility` control when
`information_schema` does not recognise a requested table.

## Layout

```
cli.ts          entry point; arg parsing, output streams, exit code
config.ts       flags and environment fallbacks
preflight.ts    reachability, distinctness, admin sessions, fixture, collision gate
fixtures.ts     the colliding fixture; provisioning, markers, collision checks
tripwire.ts     the global foreign-marker scan
http.ts         per-tenant client with an inspectable cookie jar
db.ts           optional direct Postgres access; TypeID/uuid marker forms
db-scan.ts      row-level marker search across the content and job schema
auth-flows.ts   magic-link and OTP mint/redeem primitives
crypto.ts       storage read capability and widget JWT minting (drift-pinned)
probes/         P01–P09
runner.ts       orchestration, capability gating, verdict assembly
report.ts       JSON and human rendering
```

The harness is type-checked by `bun run typecheck`, which chains its own
`tsconfig.json` after the app's — the app config includes only `src/**`, so
without that chain this directory would never be type-checked at all.

There is deliberately no root script for _running_ the probe: it needs two live
deployments, so it does not belong in `bun run test`.
