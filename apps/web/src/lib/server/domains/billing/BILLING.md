# Self-serve billing

The product bills its own tenants. This module owns the provider customer and
subscription for **this workspace**, derives the quantities the invoice is
computed from out of the product's own data, meters the usage the pricing
model charges for, and translates the resulting subscription into a plan,
entitlements and numeric limits through the seams the rest of the product
already reads.

It is **off unless configured**, and off is byte-for-byte today's behaviour.

---

## Why it lives here, and not under `integrations/`

The payment-provider integration under `apps/web/src/integrations/` is
customer-data enrichment: an admin connects **their own** payment account, and
a `post.created` hook looks up the feedback author's revenue to annotate the
post. Money flows towards the customer's business, and the credential belongs
to the customer.

This module bills **Quackback's tenants for Quackback**. Money flows towards
us, the credential is the operator's, and no admin may configure it. The two
share a vendor name and nothing else.

Putting billing in the integrations folder would have three concrete costs,
not just an aesthetic one:

1. It would appear in the integrations gallery, because that folder *is* the
   registry — `catalog.ts` per integration, rendered by
   `/admin/settings/integrations`. A tenant would see "Billing" next to
   "Slack" and be able to disconnect it.
2. Integration credentials are per-workspace and admin-writable
   (`platform-credentials`). Ours is fleet-level operator configuration that a
   tenant must never see or set.
3. The integration framework's contract is `HookHandler` — react to a product
   event, call an external API. Billing needs a webhook receiver, a database
   ledger, a reconcile loop and an admin surface. It would fit the folder's
   location and none of its shape.

**Home: `lib/server/domains/billing/`**, a peer of `settings`, `api-keys` and
the rest. It depends on `settings` (to write plan and limits through their
seams) and on `assistant` (to read resolved outcomes); nothing depends on it
except its own route, server functions and admin page. That is visible in the
dep-graph golden file as two new edges, `billing -> settings` and
`billing -> assistant`.

---

## The control-plane / product boundary

The line, stated once: **the control plane declares what may be sold; the
product decides what this workspace bought and how much of it they used.**

| Concern | Owner | Where it lives |
| --- | --- | --- |
| Organisation and account identity | Control plane | CP database |
| Tenant provisioning (database, bucket, DNS) | Control plane | CP |
| **Plan catalogue** — which plans exist, their prices, their limits | **Control plane** | `BILLING_PRICES`, fleet-wide env |
| Tenant lifecycle (suspend, delete) | Control plane | CP |
| Cross-tenant revenue reporting | Control plane | Provider dashboard + CP |
| **The provider customer and subscription** | **Product** | `settings.cloud.billing`, `billing_subscription_state` |
| **The seat count** | **Product** | derived from `principal` at read time |
| **Usage metering** | **Product** | `billing_usage_events` |
| **Checkout and portal sessions** | **Product** | `billing.service.ts` |
| **Plan, entitlements, limits** | **Product** | `settings.cloud`, `settings.tier_limits` |

The catalogue is env-configured because it is genuinely fleet-wide — the same
prices for every tenant — which is the same class as the fleet-wide AI and
email credentials in SAAS-HOSTING-STACK.md §8. Everything per-workspace is in
the workspace's own database, which is what makes this work under
database-per-tenant with no cross-tenant reads.

**Where the two writers meet.** The declarative config file is still a writer
of `settings.cloud`, and it wins wherever it declares — the managed-path
mechanism from CLOUD-CONFIG.md is unchanged. The intended cloud arrangement is
that the CP's config file declares `cloud.enabled` (and `cloud.upgradeUrl`)
and **does not declare `cloud.plan`**, leaving the plan to billing. If an
operator does pin the plan, billing is refused it and logs the refusal; the
subscription still records itself in `cloud.billing`, which the file never
claimed. Tier limits behave the same way: `tierLimits` is a whole-block
managed path, and a billing write is skipped (not thrown) when the file owns
it, because a webhook is not a request a human is waiting on.

**Entitlements are deliberately not written by billing.** They follow from the
plan through `PLAN_CATALOGUE`, so moving the plan already moves what is
unlocked. The stored `entitlements` map exists for the *other* writer — a
negotiated or grandfathered workspace an operator pinned — and a billing write
to it would erase that deal on the next subscription change.

---

## What a seat is

> **A seat is one row in `principal` where `role IN ('admin','member')` and
> `type = 'user'`.**

Not a definition invented for billing. It is:

- the predicate the product already caps with —
  `domains/principals/seat-limit.ts:25`;
- the number it already reports for metering — `teamSeatCount` on
  `GET /api/v1/admin/usage`;
- exactly the wall on the admin dashboard — `routes/admin.tsx` admits
  `['admin','member']`.

So "a seat" and "someone who can open `/admin`" are the same set. That is the
property that makes it defensible on an invoice.

Excluded, and why:

| Population | `role` | `type` | Seat? |
| --- | --- | --- | --- |
| Admin teammate | `admin` | `user` | **yes** |
| Member teammate (including every custom-role holder) | `member` | `user` | **yes** |
| Portal end user | `user` | `user` | no — a customer, not staff |
| Anonymous visitor | `user` | `anonymous` | no |
| API key / integration / CP bootstrap principal | `admin`/`member` | `service` | no — a machine |

**Pending invitations are not seats.** A seat appears when the invite is
accepted and the principal row exists. Billing for an unaccepted invite would
charge for someone who has never signed in. (Note a pre-existing enforcement
gap this inherits: `enforceSeatLimit()` runs on invite *send*, not on
acceptance, so N invites issued under a cap can all accept and exceed it.
Metering is unaffected — it counts principals, not invitations.)

**Removing a teammate frees the seat immediately.** `removeTeamMember()`
downgrades the principal to `role='user'` rather than deleting it, so the next
reconcile drops the quantity. There is no deactivated-but-retained state:
`user` and `principal` carry no status column, and teammates cannot even be
blocked (`blocking.ts:27`).

### What a lite seat is

**There is no lite-seat class in the product today.** That is a finding, not
an omission on my part, and it is the single most important caveat in this
document. Every custom RBAC role deliberately rides `principal.role = 'member'`
(`principal.service.ts`: *"Custom role grants ride the member role"*), so the
seat predicate above cannot tell an Owner from a read-only custom role. There
are four system presets — Owner, Admin, Manager, Contributor — and all four
are operator-grade. No viewer role exists anywhere in the catalogue.

A cheaper seat therefore has to be **derived**, and the derivation this module
uses is:

> **A lite seat is a teammate whose entire effective workspace permission set
> is read-only.**

Effective permissions are resolved exactly as the authorization layer resolves
them (`permissionsForPrincipal`): workspace-wide role assignments if the
principal has any, the legacy preset otherwise. Team-scoped assignments are
excluded, because they narrow access inside a team rather than conferring it.

Three properties this buys:

- **It is not gameable.** To get the reduced rate you must genuinely give the
  person no ability to change anything. A flag on the role would be free to
  set; this is not.
- **It is invisible on existing installs.** Both legacy presets carry write
  permissions, so a workspace that has never adopted custom roles has zero
  lite seats and its bill does not change the day the definition ships.
- **It moves on its own.** Grant a viewer one write permission and the next
  reconcile bills them at the full rate.

The read-only/write split is an **explicit two-list partition** in
`permission-classes.ts`, not a `.view` suffix test — the RBAC catalogue's own
header forbids prefix filters, and a suffix test misfiles `post.view_private`
(read), `copilot.use` (write) and `status_page.publish` (write). A test
asserts the two lists partition the live catalogue exactly, so a permission
added later fails CI until someone classifies it rather than silently landing
in whichever bucket over- or under-charges.

**Copilot** is an **opt-in add-on**, and the opt-in is load-bearing. The
*quantity* is derived — teammates holding `copilot.use`, the permission every
Copilot entry point already gates on (`assistant/copilot-gate.ts`) — but the
*purchase* is not. Both legacy role presets carry `copilot.use`, so on any
workspace that has not adopted custom roles the derived count equals total
headcount; an add-on inferred from a non-zero count would have been sold to
every seat on the first upgrade without the customer ever choosing it.
`checkoutLineItems()` therefore adds the line only when the caller passes
`addOns.copilot`, and the admin control defaults to unchecked while showing
how many teammates would be billed.

The asymmetry with `syncSeats()` is deliberate: the sync only ever adjusts an
item the subscription already has, so it cannot introduce a charge. Purchase
happens at checkout and nowhere else.

*(Whether headcount-derived Copilot is the right commercial default is an
operator decision, not an engineering one. Making it opt-in is the reversible
choice; deriving it is one line away if the operator wants it.)*

### What a billable outcome is

One `assistant_involvements` row in a terminal resolved status —
`resolved_confirmed` or `resolved_assumed`. That is the product's own KPI
unit, one row per conversation the assistant engaged, with an
at-most-one-resolution guard already enforced by a conditional UPDATE. A
hand-off is not billable: the assistant did not resolve anything.

The billable statuses are read from `AI_INBOX_BUCKETS.resolved` rather than
restated, so the invoice and the inbox can never disagree about what
"resolved" means.

The ledger is **derived by querying the product**, not accumulated by a
counter. Two reasons, and the first is not hypothetical:
`voidAssumedResolutionForConversation()` moves an assumed resolution back to
`active` when the customer returns needing help. A counter incremented at
resolution time would already have charged. Deriving from current state means
a resolution voided before the sweep runs is never billed at all — and
`(meter, source_id)` is unique **forever**, so a conversation that is voided
and later re-resolved is still one outcome, not two.

---

## How the lost-update window is closed

### The bug

`settings.cloud` is one JSON column with two independent read-modify-write
writers. The original `writeCloudConfig` read the row, merged in memory and
wrote the column back, and the config-file reconciler did the same thing
through `deps.updateSettings`. Interleave them:

```
T0  reconciler reads   { plan: 'pro' }
T1  billing writes     { plan: 'pro', billing.subscriptionRef: 'sub_1' }
T2  reconciler writes  { plan: 'business' }          <- subscriptionRef gone
```

Nothing errors and nothing logs. The workspace's subscription reference is
simply absent, and support has no way to find out why.

### The fix, in three parts

**1. The read, the merge and the write happen inside one row lock.**
`writeCloudConfig` now opens a transaction and takes `SELECT … FOR UPDATE` on
the settings row. `settings` is exactly one row per database, so that lock
serialises every writer of the column: the second writer's merge is computed
against the first writer's *committed* value, and both survive.

**2. Both writers actually go through the seam.** This is the part the docs
previously claimed and the code did not do. The reconciler no longer puts
`cloud` in its column update; it calls `deps.applyCloudConfig(patch)`, which
routes to `writeCloudConfig`. Two consequences beyond the lock: the config
file's block now passes through `validatePatch()` (it previously skipped it,
relying on the YAML schema alone), and there is exactly one place to change
when the merge rule changes.

`settings.tier_limits` gained a second writer at the same time and got the
same treatment: `tier-limits.write.ts` is its seam, and the reconciler calls
`deps.applyTierLimits`. Enforcement is untouched — `getTierLimits()` and every
helper in `tier-enforce.ts` read exactly what they read before.

**3. A source scanner keeps it true.** `single-writer.test.ts` walks
`lib/server/**` and fails if any file other than the declared seam emits a
`.set({ cloud: … })` or `.set({ tierLimits: … })`. A prose claim of
exclusivity that nothing checks decays the first time someone adds a
convenient `.set()` — this one used to be false already. Bootstrap inserts are
allowed separately and only from `config-file/deps.ts`, because seeding a row
that does not exist yet cannot lose anyone's write.

Alongside those, `settings.cloud_revision` is bumped on every effective write.
It is not what makes concurrent writers safe — the lock is — but it makes an
interleave *visible*, and it gives a caller that read in an earlier request
(an admin form, not a reconciler) a token to pass back as `expectedRevision`
and be refused rather than merged over.

### The proof

`cloud/__tests__/cloud-concurrency.db.test.ts` opens **two real connections**
and drives the real `writeCloudConfig` down each, concurrently, in a private
schema holding a structural copy of `public.settings`. The shared rollback
fixture cannot be used here: it parks every statement inside one transaction,
where two "concurrent" writers would not contend at all and the suite would
pass whether or not the lock existed.

Falsified by removing `.for('update')` from the source: the two interleave
tests go red, the three that do not depend on the lock stay green.

---

## Webhooks: four guarantees, four mechanisms

Conflating these is how billing systems double-charge — or charge the wrong
party.

| Problem | Mechanism |
| --- | --- |
| Forged request | HMAC-SHA256 over `<timestamp>.<raw body>`, constant-time compare, ±300s tolerance |
| **Event about another customer** | The re-fetched subscription's customer must equal this workspace's. See below |
| Redelivery | `billing_webhook_events`, primary-keyed on the provider's own event id, claimed by an upsert guarded on `processed_at IS NULL` plus a staleness lease |
| Out-of-order delivery | The handler **never trusts the event payload**. It re-fetches the subscription from the provider API and applies that, so two events arriving backwards converge on the same state |
| Two concurrent fetches | `billing_subscription_state.snapshot_fetched_at` refuses a snapshot older than the one already applied |

### Ownership: the one a signature cannot answer

A webhook endpoint subscribes to event **types**, never to customers, and the
endpoint secret authenticates the *endpoint* rather than the subject. Under one
operator account with a per-tenant endpoint URL, **every tenant's endpoint
receives every other tenant's subscription events**, each correctly signed for
the endpoint that receives it. "Correctly signed" means "really from the
provider" — never "about us".

Without the check, one ordinary delivery does three things, and the third is
the worst: this workspace's plan silently becomes whatever a stranger bought;
this workspace's seat count is pushed onto **the stranger's** subscription,
changing their invoice; and because `currentSubscriptionRef()` orders by
`updated_at`, the foreign row wins, so "Manage billing" opens another
customer's portal, invoices and card.

The check runs on the **re-fetched** subscription rather than the event
payload, for the same reason the ordering guarantee does: the payload is a
claim, the API response is the fact. A foreign event is acknowledged (200,
`handled: false, foreign: true`) and recorded as consumed — a non-2xx would
make the provider retry it forever — and logged at `warn`.

One deliberate carve-out: a workspace with **no** customer yet adopts the
first subscription it is told about, because checkout completes at the
provider before any reference exists locally and rejecting it would make
self-serve signup impossible. The window closes at the end of that same first
event. The residual exposure is a foreign event arriving before a workspace's
own checkout completes; `ensureCustomer()` creates the customer before
checkout on the self-serve path, so in practice it only exists for a
subscription created out of band.

### Three more details worth stating

- **The signature's timestamp tolerance is transport anti-replay, not
  idempotency.** A legitimate redelivery inside the window is a valid,
  correctly-signed duplicate; only the event ledger stops it.
- **A failed handler releases its claim**, and a *crashed* one is reclaimed
  after `CLAIM_LEASE_MS`. The normal error path deletes the claim row; a pod
  kill, an OOM or a failing release cannot, so the claim upsert also reclaims
  any row that is unprocessed and older than the lease. Without that second
  half, an interrupted delivery was answered "duplicate" forever while nothing
  had ever been applied. An attempt that is unprocessed but *recent* is still
  a duplicate — running two handlers concurrently would push seat quantities
  twice for no benefit.
- **The response code is the retry instruction.** 500 for anything a resend
  could fix; 400 for a bad signature or unparseable body, because retrying
  those forever helps nobody.

## Recovery: the reconcile timer

`reconcileBilling()` runs every 15 minutes under a cross-instance sweep lock
(`billing_reconcile`), registered inside `startBackgroundProcessing()` — so it
is role-gated off `QUACKBACK_ROLE=web` replicas and is a no-op on any install
with no provider configured.

It is the **same routine the webhook path runs**, which is what keeps a missed
delivery a delay rather than a permanent divergence: it re-reads the
subscription, re-applies plan and limits, pushes seat quantities, and derives
and reports usage. The admin page's Refresh button calls it too.

Seat quantities are pushed as *declarative* quantities rather than usage
events, which is why they need no ledger: pushing the same number twice is a
no-op at the provider. Outcomes are append-only events, which is exactly why
they do.

---

## What an unconfigured install experiences

Nothing. With no `BILLING_API_KEY` / `BILLING_WEBHOOK_SECRET` /
`BILLING_PRICES` — every self-hosted install, and any deployment that has not
opted in:

| | Behaviour |
| --- | --- |
| `getBillingConfig()` | `null`. Resolved once, logged once at boot |
| Admin nav | No Billing row. Structurally identical to before |
| `/admin/settings/billing` | Not linked; renders "not configured" if reached directly |
| `fetchBillingOverviewFn` | `null` — no query, no provider call |
| `POST /api/billing/webhook` | `400 billing_not_configured`, no database write |
| Seat metering | Never runs |
| Usage metering | Never runs |
| Plan / entitlements | Unchanged: `settings.cloud` stays NULL, everything granted |
| Numeric limits | Unchanged: unlimited |
| Extra queries per request | Zero |
| New module-scope cache | One: the resolved config. Fleet-wide, same class as `config.openaiApiKey` |

`default-off.test.ts` demonstrates this by driving each real entry point with
an empty environment and a database proxy that **throws on any access**, so
"does nothing" includes "does not query". `settings-nav-billing.test.ts`
compares whole nav structures rather than checking for a substring.

A **partial** configuration is also off, and loudly: it logs an error naming
which variables are missing, because silently behaving like "billing is
disabled" while an operator believed they had enabled it is worse than either
outcome.

---

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `BILLING_API_KEY` | yes | Provider secret key. `sk_test_…` / `rk_test_…` is test mode |
| `BILLING_WEBHOOK_SECRET` | yes | Endpoint signing secret |
| `BILLING_PRICES` | yes | JSON plan catalogue (below) |
| `BILLING_ALLOW_LIVE` | only for live keys | Must be `"true"` before a live-mode key is accepted |
| `BILLING_RETURN_URL` | no | Base URL for checkout/portal returns. Defaults to `BASE_URL` |

```jsonc
{
  "free": { "seat": "price_...", "limits": { "maxBoards": 3 } },
  "pro": {
    "seat": "price_...",          // per full seat
    "liteSeat": "price_...",      // per read-only seat
    "copilotSeat": "price_...",   // per seat holding copilot.use
    "outcome": "price_...",       // metered, per resolved outcome
    "outcomeMeter": "quackback_resolved_outcome",
    "limits": { "maxBoards": 25, "aiTokensPerMonth": 1000000 },
  },
}
```

**A live key is refused unless `BILLING_ALLOW_LIVE=true`.** This is not
ceremony: the classic incident is a staging or review environment inheriting
the production key and charging real customers from synthetic seat counts.
Requiring a second, explicit variable makes a live key an intentional act. An
unrecognised key prefix is treated as **live**, because assuming test mode for
a key that is actually live is the expensive direction of that mistake.

The catalogue may declare a subset of the modelled plans — selling only Pro
and Business is normal. A price filed under a plan the product does not model
turns billing **off** rather than being dropped, because dropping it would
resolve subscriptions to no plan and silently downgrade paying workspaces.

---

## Schema (migration 0250)

Expand-only. Additive column with a default, three new tables, nothing
dropped, renamed, retyped or tightened — so it can land before the code that
reads it, which is the ordering rule a pooled fleet requires
(SAAS-HOSTING-STACK.md §5). The contract linter on `migration-safety-linter`
reports zero destructive findings for it.

- `settings.cloud_revision` — optimistic-concurrency token, mirroring the
  existing `assistant_config_revision`.
- `billing_webhook_events` — idempotency ledger, keyed by provider event id.
- `billing_usage_events` — usage ledger, unique on `(meter, source_id)`.
- `billing_subscription_state` — provider mirror: the snapshot ordering guard
  and the last-synced quantities. **Not** a second source of truth for plan or
  entitlements, which stay in `settings.cloud`.

---

## A note on naming

The vendor is named only where the protocol defines the spelling — the API
host, the signature header, and one form field in the meter-event payload.
`CLAUDE.md`'s carve-out for genuinely-integrated products is scoped to
`apps/web/src/integrations/**`, which this module deliberately is not, so
everything we choose ourselves (`BILLING_PROVIDER`, comments, test fixtures)
describes the pattern instead. `no-vendor-names.test.ts` enforces it with an
exact-line allowlist.

## Known gaps

- **Only the entitlements Piece 16 wired are enforced.** `customDomain` and
  `sso` have gates; the other seven catalogue entries are documented but not
  yet at their chokepoints. A plan change moves them all in `listEntitlements()`
  and the admin UI, but seven of them gate nothing yet.
- **No retention sweep for either ledger.** `billing_webhook_events` and
  `billing_usage_events` grow without bound. The webhook ledger's window has
  to exceed the provider's redelivery horizon (months, not hours), and the
  usage ledger is the record of what was billed, so neither is trivially
  prunable — but both need a policy eventually. No pruning code is written
  rather than written-and-unwired, so there is nothing to mistake for a
  working sweep.
- **Usage is reported one event per HTTP call.** Fine at the volumes a single
  workspace produces; a batching endpoint would be better at fleet scale.
- **`cloud.upgradeUrl` is still off-type.** `StoredCloudConfig` does not
  declare it and both writers reach it through casts — inherited from Piece 16
  and not fixed here.
- **Proration is the provider's.** Seat changes are pushed as quantity
  updates and whatever proration behaviour the prices carry applies. The
  product does not model it.
