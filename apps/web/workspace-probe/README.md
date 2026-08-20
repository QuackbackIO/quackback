# Workspace isolation probe

An adversarial two-workspace probe suite. It provisions two synthetic workspaces with
deliberately colliding data, then actively attempts cross-workspace access and
asserts that every attempt **fails closed** — a loud, distinguishable refusal,
never a plausible-looking wrong answer.

## Why this exists

From `SAAS-HOSTING-STACK.md` §3, on pooled multi-tenancy:

> If workspace resolution ever returns the wrong connection pool, **every RBAC and
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

| Kind         | Meaning                                                         | Failure becomes |
| ------------ | --------------------------------------------------------------- | --------------- |
| `positive`   | the mechanism works inside its own workspace                    | `ERROR`         |
| `negative`   | the adversarial cross-workspace attempt                         | `LEAK`          |
| `invariant`  | a config fact whose violation _is_ a cross-workspace capability | `LEAK`          |
| `visibility` | the probe's ability to observe at all                           | `ERROR`         |

This is centralized deliberately. An earlier version let each probe pick its own
failing controls with a local filter, and one of those filters dropped
`invariant` failures from the decision — so a probe could observe a shared
secret, record it, print it, and still return `PASS`. Classifying a control is
now the whole of a probe's verdict logic.

**Every exit from a probe goes through `decide()`, including the early ones.**
That sentence used to read "there is no filter that can record a signal without
counting it", and it was not true. Seven of the nine probes returned through a
bare `error()` constructor that hard-coded `verdict: 'ERROR'` while passing the
controls recorded so far along for display. A failed `invariant` is a LEAK by
the table above — so P03 could write _"IDENTICAL — every read capability minted
for either workspace verifies against both, by construction"_ into its own output
and return `ERROR` with `LEAK: 0`, because a later positive control also failed
and the early return got there first. On a real fleet with one storage secret
serving both workspaces, that run says "could not run" rather than "cross-workspace
capability found", and exits 1 instead of 2.

`error()` is gone. Probes stop early with `halt()`, which records the stopping
condition as a failed `visibility` control and hands everything to `decide()`;
`decide()`'s precedence already puts LEAK above ERROR, and the blindness is
demoted to a note appended to the leak. `blocked()` does the same when it is
handed a control that already failed — "not executed" must not be able to
swallow an observation. A test in `__tests__/end-to-end.test.ts` scans
`probes/*.ts` for a hand-built `verdict:` literal, so the escape hatch cannot
be reopened.

The same rule now applies to the runner: a tripwire hit upgrades **any**
non-LEAK verdict, not only `PASS`. A foreign marker in a response body is a
cross-workspace observation whether or not the probe that made the request also
managed to finish.

**Workspace identity is planted, not derived.** The suite does not infer what
makes a workspace distinguishable from the values each workspace happens to have
stored — any rule built on stored values can certify the workspaces
distinguishable on a surface where they are not (the workspace TypeID appears
in no public surface, ever). Instead each workspace carries a probe-owned identity
token (`qbprobeidentityalpha` / `qbprobeidentitybravo`, or the operator's own
via `--alpha-identity-token`), planted into a settings-derived field a public
surface renders, and installed as a tripwire marker at preflight. A foreign
planted token on the wrong host has no innocent explanation, so it accuses on
its own — and a **partial** identity leak (one field crossing while the host
keeps rendering its own) fails by construction, because the leaking surface
carries the foreign planted token while missing the host's own. See
[Planted identity](#planted-identity) below.

**A derived marker must still be able to accuse.** For the vocabulary the suite
does NOT control — workspace names, slugs, theme colours — two filters stand
between a stored value and a verdict (`vocabulary.ts`): tokens that could
appear in any workspace's output are never admitted (greys and near-universal
colours, short strings, names built entirely from common product vocabulary,
and anything this suite's own fixture writes into both workspaces), and an
admitted token only accuses when the host serving it shows **none of its own
identity** on that surface. A host rendering its own name alongside a word that
happens to also be in the other's settings is plainly rendering itself.

**Every cross-workspace attempt is made in both directions — per attempt, not per
probe.** Every `negative` control declares its direction, and every
single-direction control declares which attempt it is one direction of
(`attemptId`); a test asserts each attempt covers both. A probe-aggregate check
came first and could not stop a one-directional control landing in an
already-symmetric probe. This is not tidiness: an email-keyed credential stash
is last-writer-wins, so testing one direction leaves detection to whichever
workspace's value happens to survive.

**Every response is scanned for the other workspace's markers, including the
responses to the deliberate attempts.** Probes assert on what they attacked; the
tripwire catches what the probe author did not think to check. Its vocabulary is
the planted identity tokens, the per-workspace canary strings, and workspace-unique
TypeIDs, none of which can collide or appear in ordinary chrome. A tripwire hit
overrides whatever the probe concluded.

The `expectsForeignMarkers` flag used to exempt an exchange from collection
entirely — and **every** deliberate cross-workspace attempt in the suite sets it,
so the tripwire's real coverage was incidental traffic only. It was switched off
on precisely the replays it exists to backstop, leaving those covered by
whatever each probe author had coded a check for: P01, P05 and P08 call
`markersPresent` themselves; P02, P03, P04, P06 and P07 call nothing. The flag
now only labels a hit `deliberate`. Echo suppression is instead done on the one
basis that is sound — a marker the harness itself put on the wire is never
counted — and "the wire" means the whole request: url, body, headers (a replayed
cookie or Bearer credential travels nowhere else) and any base64url payload
inside them (a signed token's claims). `record()`'s hits are also carried back
on `ProbeResponse.tripwireHits`, which `http.ts` previously discarded.

**A probe must judge a surface that actually carries the evidence.** `GET /`
answers `307 → /?sort=trending` with a **zero-byte body**, and `GET /admin`
answers `307 → /?auth=signin…` the same way, because the route's search schema
canonicalises before it renders. With redirects unfollowed, every probe that
"read the portal document" read an empty string and reported it clean — so the
planted identity token, the whole answer to three previous rounds of false
greens, contributed nothing to a run. The only thing that noticed was P06's
admissibility gate refusing to certify hosts it had never caught serving their
own token.

Document reads therefore set `followRedirects`, and `http.ts` follows them by
hand rather than with `redirect: 'follow'` for one reason: **a redirect that
leaves the workspace's own origin is never followed.** A probe that chased alpha's
redirect onto bravo's host and then reported "no foreign markers in alpha's
document" would be reading bravo's page and calling it alpha's, which is worse
than reading nothing. A refused cross-origin redirect becomes a failed
`visibility` control (the surface could not be judged), or a failed `negative`
when the origin it pointed at is the other workspace under test — being handed
across the boundary is itself the finding. Every hop is tripwire-scanned.

## The colliding fixture

Both workspaces are given identical human-readable data on purpose:

| Field             | Value (both workspaces)                |
| ----------------- | -------------------------------------- |
| Admin address     | `admin@example.com`                    |
| Board name / slug | `Feature Requests` / `workspace-probe` |
| Post title        | `Dark mode`                            |
| Widget visitor    | `probe-visitor@example.com`            |

Only two things differ: a per-workspace canary token in the post and board body
(`qbprobecanaryalpha` / `qbprobecanarybravo`) and the row ids. That is the whole
point — a wrong-workspace answer is indistinguishable from a right one on every
field a naive assertion would look at.

A third thing differs by operator action rather than by provisioning: the
planted identity token (below).

The suite refuses to run if the collision is absent, if the canaries or ids match
across workspaces, or if both URLs resolve to the same workspace. Each of those
would make a `PASS` meaningless.

Provisioning is find-or-create against stable slugs, so running twice leaves the
same state and returns the same verdict.

## Planted identity

The suite already trusts a planted canary in post content; the same trust is
extended to workspace identity. This is the §3 database-fingerprint idea applied
probe-side: instead of inferring which stored values make the workspaces
distinguishable, the suite plants one.

**What gets stamped, and where.** One identity token per workspace — the
suite-owned defaults `qbprobeidentityalpha` / `qbprobeidentitybravo`, or a
custom value declared with `--alpha-identity-token` / `--bravo-identity-token`
(env `ALPHA_IDENTITY_TOKEN` / `BRAVO_IDENTITY_TOKEN`). The operator stamps it
into a settings-derived field that a public surface renders: the workspace
name, or the portal welcome-card headline in `portal_config`. There is
deliberately no auto-stamp — the app exposes no writable settings endpoint
(settings mutations are server functions behind the admin UI, not addressable
URLs), so the flags are the mechanism, not a fallback. If a writable endpoint
ever lands, provisioning should stamp the token itself.

**How it flows to a verdict.** Preflight validates the vocabulary (distinct,
non-generic, long enough to accuse, neither a substring of the other — a hard
gate, like same-origin) and installs each token as a tripwire marker, so every
response in the run is scanned for the wrong workspace's token. P06 then checks,
per public surface per direction, that neither host ever serves the other's
token, and enforces the one admissibility rule the suite keeps: **each host
must be caught serving its own planted token on at least one judged surface**,
or the probe reports `ERROR`, never `PASS`. The gate counts observed responses,
not stored values — the round-3 gate counted the workspace TypeID (present in
no public surface) and the one unleaked colour, and so certified the workspaces
distinguishable on a surface where they were not.

**What it proves.** Because the token is probe-owned and appears in no UI
chrome, genericity filtering is unnecessary for it — a workspace named
`Help Center` or `Acme` is as judgeable as any other. And because corroboration
is now "the host serves its own planted token", a **partial** identity leak —
bravo rendering alpha's cached name while painting bravo's own colour — fails
by construction: the leaking surface carries the foreign planted token while
missing the host's own. That shape passed the suite green in round 3 with all
three derived-vocabulary defences missing it for three different reasons.

The derived vocabulary (name, slug, id, theme colours, minus generic values)
is retained as a secondary layer: it still catches leaks on surfaces the
planted token does not reach — the widget public config carries colours and no
text — and a leak observed there is evidence regardless. It just can no longer
produce a `PASS` on its own.

## Running it

```bash
bun apps/web/workspace-probe/cli.ts \
  --alpha http://alpha.localhost:3000 \
  --bravo http://bravo.localhost:3000 \
  --alpha-api-key qb_… --bravo-api-key qb_…
```

Point it at a deployed fleet by changing nothing but the two URLs:

```bash
bun apps/web/workspace-probe/cli.ts \
  --alpha https://alpha.example.com --bravo https://bravo.example.com \
  --alpha-api-key "$ALPHA_KEY" --bravo-api-key "$BRAVO_KEY" \
  --json-out isolation-report.json
```

`bun apps/web/workspace-probe/cli.ts --help` lists every flag. Each has an
environment-variable equivalent (`ALPHA_BASE_URL`, `ALPHA_API_KEY`,
`ALPHA_DATABASE_URL`, `ALPHA_S3_SECRET_ACCESS_KEY`, `ALPHA_WIDGET_SECRET`,
`ALPHA_IDENTITY_TOKEN`, and the `BRAVO_` twins) so CI can pass secrets without
putting them in argv.

**Output.** The JSON report goes to stdout (or `--json-out <path>`); the human
summary and progress logging go to stderr. `... | jq` therefore works unmodified,
and a leak stays legible when the JSON is piped away.

**Exit codes.**

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | every probe passed                                               |
| `1`  | a probe could not execute (`ERROR` or `BLOCKED`); nothing leaked |
| `2`  | a cross-workspace observation was made                           |

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

`--teardown` removes the fixture from both workspaces.

### Inputs and what they unlock

Only the two URLs and the two API keys are needed to run. Everything else widens
coverage, and a probe whose inputs are missing reports `BLOCKED` with the exact
flag to pass — never a silent skip.

The API keys need the post view-private permission (fixture provisioning reads
the fixture back) and the comment-moderate permission (P07 drives its background
work by commenting on the fixture post). A key without the latter makes P07 stop
with the rejected write quoted, not pass.

| Input                                               | Unlocks                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--alpha` / `--bravo`                               | reachability, and every HTTP probe                                                                 |
| `--alpha-api-key` / `--bravo-api-key`               | **fixture provisioning** (required), P05, P07's drive write                                        |
| `--admin-email` / `--admin-password`                | P01, P02 (defaults `admin@example.com` / `password`)                                               |
| `--alpha-db` / `--bravo-db`                         | P02, P07, P09, and the row-level scans in P06/P08. Also reads the widget secrets automatically     |
| `--alpha-storage-secret` / `--bravo-storage-secret` | P03                                                                                                |
| `--alpha-widget-secret` / `--bravo-widget-secret`   | P04 (or supply the database URLs)                                                                  |
| `--alpha-identity-token` / `--bravo-identity-token` | P06's planted identity vocabulary (only when a custom token was planted; defaults are suite-owned) |

## The probes

| Id      | Family    | What a `PASS` proves                                                                                                                                                                                                                                                     |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P01** | session   | A session minted by alpha authenticates nothing on bravo — not as a cookie, not as a raw Bearer token, and not on an authenticated SSR document.                                                                                                                         |
| **P02** | session   | A magic-link token or sign-in OTP minted by one workspace establishes no session on the other, _while the other workspace holds its own live credential for the identical address_, and each workspace's own credential resolves to its own user.                        |
| **P03** | storage   | A private-object read capability minted with one workspace’s storage secret is refused by the other for the identical object key, and one workspace’s secret does not verify against the other’s own signed message — i.e. the workspaces do not share a storage secret. |
| **P04** | widget    | A widget SSO token signed with one workspace's widget secret mints no session in the other, and a widget session token issued by one resolves to no user in the other.                                                                                                   |
| **P05** | api       | A REST API key issued by one workspace is rejected with 401 by the other, and returns neither the issuer's rows (wrong pool) nor the target's (wrong credential accepted).                                                                                               |
| **P06** | cache     | Settings-derived public surfaces read in a tight interleave never serve one workspace's planted identity token, stored identity, branding or configuration under the other's hostname — and each host provably serves its own planted token.                             |
| **P07** | jobs      | A write driven on alpha produces derived background rows carrying _this run's_ drive token in alpha's database and none at all in bravo's.                                                                                                                               |
| **P08** | read      | No public surface on bravo returns a row, id or canary belonging to alpha — including a search for a title that exists identically in both workspaces.                                                                                                                   |
| **P09** | assistant | Each workspace's assistant service principal is its own row, and neither database contains a reference to the other's principal id, in TypeID or uuid form.                                                                                                              |

Two constructions are worth calling out because they are what make the probes
sensitive rather than ceremonial.

**P02 makes both workspaces hold a live credential for the same address before
attempting any cross-redemption.** Otherwise "bravo refused alpha's token" is
explained by "bravo has no such row" — the trivial case. With a live row present
for that exact address, bravo must refuse a token it did not itself mint.

**P06 judges identity on a token the suite planted, and treats what each workspace
has stored as a secondary layer.** An earlier version searched served responses
for the workspace slug and the workspace TypeID and could not see a
settings-cache leak at all, because neither string is present in what leaks:
`/api/widget/config.json` carries theme colours, tabs and flags and no
identifier whatsoever, and the portal document carries the workspace _name_.
The planted token is what a partial leak cannot escape (see
[Planted identity](#planted-identity)); underneath it, the probe still reads
`name`, `slug`, id, `branding_config` and `custom_css` from each workspace's
settings row, reduces them to the tokens **exclusive** to one workspace and not
generic, and asserts neither host ever serves the other's in place of its own.
Stability across the interleave is measured on those tokens rather than on raw
bytes, so a CSP nonce or a timestamp cannot manufacture a false `LEAK`.

**P03 holds constant everything except the secret — the binding as well as the
key.** A signature is bound to its key, so signing alpha's key and presenting it
for bravo's key would be refused by arithmetic rather than by isolation. That
argument was already in the probe for the object key; it applies equally to the
workspace binding, and it was not being applied there. Under pooled tenancy the
signed message is `workspaceBind('read|<key>')`, which prefixes `t:<workspaceKey>|`
(`storage/s3.ts`), so once workspace ids are supplied alpha's capability can never
verify on bravo **whatever the secret is** — the messages differ. The negative
control could not fail, and detection rested entirely on an `invariant`
comparing two strings the operator typed rather than two facts read from the
fleet.

So P03 now makes two attempts in each direction:

| Attempt                      | What is presented                                              | What its failure means                            |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| `storage-read-capability`    | alpha's capability exactly as alpha's own URLs carry it        | a URL from one workspace is honoured by the other |
| `storage-secret-interchange` | the message **bravo** verifies, HMAC'd with **alpha's** secret | the two workspaces share a storage secret         |

The second is the one that can fail once binding is in force, and it is the
condition §9 depends on being false. When the bindings differ, the first
attempt's own detail text says it is over-determined rather than reporting a
bare "refused with 403" — a probe that knows it cannot fail must not read as
though it could.

The binding each host verifies is **calibrated against that host**, not assumed
from the flags: the probe mints under each candidate message and keeps the one
the workspace's own deployment accepts. A `--alpha-workspace-key` that does not match
then fails the positive control loudly instead of quietly making every negative
unfailable. The object need not exist — the handler verifies the capability
before it touches storage, so a rejected signature is a clean 403 and an
accepted one falls through to the object path.

## What is not fully exercisable today

Compute on this fleet is **already pooled**: one service, `numReplicas: 1`, one
region, one `SECRET_KEY`, one auth instance cache, and one shared
`quackback-worker` with no per-workspace `DATABASE_URL`. What is still per-workspace is
the DATABASE. That distinction is the whole of this section, and getting it
backwards is not a harmless inaccuracy — it made the suite understate its own
strongest evidence, describing P01's pass as over-determined by a topology the
fleet does not have.

So the caveats below are not "this probe cannot fail yet". They are the narrower
and more durable thing: **what a pass here does not distinguish.** For the
credential probes that residual is real and permanent while databases stay
per-workspace — sessions and `verification` rows live in the workspace's own database,
so a lookup routed to the wrong pool finds no row and refuses in exactly the way
a correctly routed lookup refuses an unknown credential. Database-per-workspace
alone explains the same silence.

Each affected probe carries a `poolingCaveat`, printed in the summary next to its
`PASS` and present in the JSON, so this can never be read as a clean bill of
health.

| Probe   | What its pass does not distinguish                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P01** | Nothing about the topology weakens this one: one process, one signing key, one better-auth instance cache, both workspaces on `auth_config_version` 3 — the coinciding-counter case — and one shared admin address. It is load-bearing today. The residual is that `session` rows are per-workspace, so "resolution was correct" and "resolution was wrong and missed" produce the same refusal.                                                               |
| **P02** | The email-keyed stashes it was written against are `WorkspaceKeyedCache` instances now (`auth/index.ts:73-74`), so the collision has no mechanism left, and the probe never touches them anyway — it reads each workspace's credential from that workspace's `verification` table. A pass is evidence about the database-backed redemption path and the workspace-keyed auth instance serving it. Same residual as P01: `verification` rows are per-workspace. |
| **P06** | The bare-literal `CACHE_KEYS` (`settings:workspace`, `auth:registered-providers`, …) that made this collide no longer share a namespace: the cache is `kv_store`, discriminated by the `workspace_key` column. The probe confirms the surfaces are distinguishable and self-consistent; the collision has no mechanism left to exercise.                                                                                                                       |
| **P07** | The worker tier is genuinely shared — one service, one replica, no per-workspace `DATABASE_URL` — so a misrouted job CAN reach the other database and this probe is load-bearing today. The residual is that it observes rows and not processes: it cannot see a job that ran against the wrong workspace and only READ, nor tell a correct write from a wrong-workspace write that failed.                                                                    |
| **P09** | `memoizedAssistantPrincipalId` (`assistant.orchestrator.ts:66`) is now a `WorkspaceKeyedCache`, so poisoning needs the workspace key to be wrong or absent rather than merely shared. The probe proves the two ids are distinct and unreferenced — when both exist at all; see the note on P09 being blocked below.                                                                                                                                            |

P03, P04, P05 and P08 are fully meaningful today: they test secrets, credentials
and query scoping that are already shared-or-not regardless of process topology.
P03 in particular directly tests the property §9 relies on to justify
bucket-per-workspace.

### P09 is blocked, and the suite cannot unblock it

Neither workspace holds an assistant service principal row. It is provisioned
lazily by `ensureAssistantPrincipal()`, which is reached only from a genuine
assistant interaction — an assistant turn in a conversation, an AI
classification, a Copilot question, or a workflow plan containing a `send_block`
action. Every one of those requires the workspace to have an AI provider configured
and the relevant feature enabled, and none of them is reachable from the REST API
this suite provisions its fixture through.

So this is **not** a gap in fixture provisioning, and it is not fixed by
inserting a `principal` row into each workspace database. That row is one the
application would never create, and P09 exists to detect a memoised principal id
crossing the workspace boundary: a hand-planted principal would satisfy the probe
while proving nothing about the memo. P09 correctly refuses to pass on the
absence and reports `BLOCKED`, which fails the run unless the operator passes
`--allow-blocked`.

To unblock it: configure AI on both workspaces and ask Quinn one question in each,
then re-run.

## Surfaces and families no probe can judge

Distinct from the pooling caveats above: those are probes that run but whose
`PASS` is over-determined today. These are things nothing in the suite looks at
at all. A future reader needs this list more than any of the green ticks.

- **Presence signals are covered only at the row level.** P08 scans bravo's
  database for alpha's markers, which catches persisted presence, but it does not
  open an SSE stream and watch for a cross-workspace presence event. The unworkspaceed
  `AGENTS_ZSET = 'conversation:presence:agents'` key §7.4 named is gone —
  presence is `presence_stream`, keyed on `workspace_key` with `is_agent` a column —
  but the live SSE path is still not directly probed. No probe opens a stream of
  any kind.
- **P06 cannot see a cache that is shared but not observable.** It reads the
  public surfaces that settings feed; a cached value with no public projection
  (webhook rows, registered auth providers, resolved platform credentials) is out
  of its reach over HTTP, and the database scan reads stored rows rather than
  what a process is holding.
- **The judged HTTP surfaces are three.** `/`, `/b/<slug>/posts/<postId>` and
  `/api/widget/config.json`, plus `/admin` for P01. It was `/b/<slug>` until a
  live run showed that URL answering **404 on both workspaces** — there is no board
  index route in the app, only `/b/$slug/posts/$postId` — so two of P08's ten
  controls were passing against an empty page. Both halves of that were fixed:
  the probe now reads a document that exists, and every judged document must
  first be shown to render some workspace identity before any "contains no foreign
  marker" conclusion is drawn from it. A surface that 404s is a failed
  `visibility` control, which is `ERROR`, never a pass. The help centre,
  changelog,
  status pages, roadmap, the whole `/api/v1` surface beyond boards and posts, and
  every authenticated admin route other than the shell are unjudged. A settings
  leak that reached only `/hc` would not be seen.
- **Nothing probes outbound traffic.** A webhook, an email or a workflow
  connector firing against the wrong workspace's destination is invisible here:
  every probe observes responses to requests it made itself, plus rows.
  P07 detects a cross-workspace background WRITE, not a cross-workspace SEND.
- **Storage is probed only for the capability, never for the object.** P03
  establishes that the read token does not transfer. Whether the two workspaces'
  objects live in the same bucket, and whether a key from one is reachable in the
  other once a valid capability exists, is not tested — the probe deliberately
  uses a key that need not exist.
- **P03's plain-replay negative cannot fail under pooled binding.** It says so
  in its own output, and the interchange attempt carries the verdict, but the
  replay itself is ceremonial once workspace ids are in force.
- **File-level and queue-level isolation of the worker tier is inferred, not
  observed.** P07 asks "did a row land in the other database", which is the
  right question, but it cannot see which worker process ran the job.
- **A leak that renders identically in both workspaces and touches no marker is
  invisible by construction.** That is the price of the colliding fixture: the
  markers are the only discriminator, so a cross-workspace read of a field carrying
  none of them (a timestamp, a counter, an aggregate) passes.

## Self-tests

```bash
bun run test   # or: bunx vitest run apps/web/workspace-probe
```

`__tests__/leak-detection.test.ts` is the important one. It plants each hazard
into an in-process two-workspace fleet — shared session store, shared storage
secret, shared API keys, shared search index, shared widget secret, shared
settings cache — and asserts the matching probe reports `LEAK`, that the clean
fleet reports `PASS`, and that a misconfigured or unreachable target reports
`ERROR`. A suite that only ever ran against a correct system would be validated
against the one case where every possible implementation passes.

`__tests__/crypto-drift.test.ts` pins the two tokens the harness mints for itself
against the real verifiers imported from the app. `storageReadSig` is
module-private in `lib/server/storage/s3.ts`, so the harness re-implements it; if
the server's construction ever changes, the minted token would be malformed,
every cross-workspace attempt would be refused for the wrong reason, and the probe
would report a false `PASS`. This makes that drift break `bun run test` instead.

`__tests__/end-to-end.test.ts` drives the real `runSuite → report → exit code`
path against a planted fleet, rather than calling `probe.run()` directly. It
tests **both poles**: alongside each planted leak it runs correct fleets built
specifically to trip the identity vocabulary — a workspace whose CSS contains an
ordinary `#ffffff`, a workspace named `Support` that the other workspace's own
navigation renders, and a workspace named after the board this suite creates in
both workspaces. All three must exit 0, and a real leak on a generically-named
fleet must still exit 2. The round-4 block plants the leak that defeated every
derived-vocabulary defence — a **partial** identity leak on generically-named
workspaces, bravo rendering alpha's cached name while painting bravo's own colour —
and asserts it now exits 2 with the tripwire firing on the planted marker, that
the same fleet stays green when nothing leaks, and that an unplanted token
yields `ERROR`, never `PASS`. It also runs a shared credential stash under
**both** write-order polarities, and asserts the direction guard **per attempt**
(`attemptId`), so a one-directional control cannot hide inside an
already-symmetric probe. This
is the file that matters most, and it exists because probe-level tests were not
enough: three defects survived an earlier sensitivity pass — P02 could never
execute at all, P07's blind guard was satisfied by fixture data, and P06 reported
`PASS` on the leak it was written to catch — and two of those probes were never
imported by a test.

Excluding `FIXTURE_TABLES` closed only the first half of P07's guard, and the
README used to leave that sounding finished. It stops a guard being satisfied by
the STATIC fixture — the canary the fixture writes into `boards.description`.
It does nothing about a genuine derived row from an EARLIER run: a
`post_activity` row, in a table no exclusion list would name, still referencing
the same fixture post id days later. That is what happened on the live fleet, and
the probe passed on it. Freshness is not a property of the table a row is in, so
the exclusion could never have established it; the per-run drive token does.

Every case here asserts on the report and the exit code,
including that a clean run and a leaking run do not produce identical output,
and that a per-request nonce does not manufacture a `LEAK`.

The round-5 block covers the four ways the suite could not fail at all: that a
judged document is read past the canonicalising `307` (and that the planted
token is consequently observable, which it was not); that a redirect off the
workspace's own origin is refused and named rather than followed; that a failed
`invariant` surfaces as `LEAK` even when the probe had to stop early; and that
a tripwire hit on a deliberate cross-workspace attempt is counted. It also scans
`probes/*.ts` for a hand-built `verdict:` literal, which is what keeps
"every exit goes through `decide()`" true rather than merely currently-so.

The round-6 block is about **evidence that is real but is not this run's**. It
runs a fleet whose drive write is accepted (`< 400`) and inert, with the derived
`post_activity` row an earlier run left still sitting in the database — the exact
arrangement the live fleet was in when P07 reported `PASS` — and asserts `ERROR`,
that the failing control names the stale rows, and (separately, so the premise is
pinned rather than trusted) that the stale row really is present and really does
reference the fixture post. It also asserts that the drive write's own row does
not count as work having been driven, and that a judged document which does not
render is a failed `visibility` control rather than a clean read.

**The fake fleet now reproduces the canonicalising redirect** (`/` → `307`
`/?sort=trending`, `/admin` → `307` `/?auth=signin…`, both zero-byte), the
pooled storage binding (`t:<workspaceKey>|read|<key>`), the **404 on `/b/<slug>`**
(there is no board index route, only `/b/$slug/posts/$postId`), and an
**accepted-but-inert drive write**. Its being _more forgiving than the fleet it
stands in for_ is what let two defects live: the planted token rendered in every
test and in no real run, and the harness had no way at all to express "the write
was accepted and nothing happened", so the one arrangement that produced a false
green was the one arrangement the tests could not build.

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
preflight.ts    reachability, distinctness, admin sessions, identity-token gate, fixture, collision gate
fixtures.ts     the colliding fixture; provisioning, markers, planted identity tokens, collision checks
tripwire.ts     the global foreign-marker scan
http.ts         per-workspace client with an inspectable cookie jar
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
