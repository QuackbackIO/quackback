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

### Scope: new tenants only

**Operator decision.** *"Billing should work under new way for new tenants."*

This module owns tenants provisioned on the new stack. Existing tenants stay
on the control-plane billing path, and **there is no migration between them** —
so a provider customer with no workspace stamp being refused is not a
limitation to work around, it is the boundary working. Such customers belong
to the old path by definition.

The practical consequence: `ensureCustomer()` stamps before checkout on every
tenant this module serves, so the adoption path exists for robustness rather
than as a routine flow.

> **A seat-definition change is a silent invoice change on deploy.** Any
> existing workspace with an AI-operations custom role — inbox reads plus
> `assistant.manage`, and no other support-side write — moves from lite to
> full on the next sync, which pushes new quantities and prorates. Nobody is
> asked. That is intended and moot under new-tenants-only, because no existing
> workspace is billed by this module at all. **If that cutover ever widens,
> the widening must account for it**: any change to
> `SUPPORT_WRITE_PERMISSIONS` or `SUPPORT_SURFACE_EXTRAS` reprices the
> installed base at the moment it ships.

> **Hazard, not a workaround.** Seeding `cloud.billing.customerRef` through
> `config.yaml` looks like a way to hand this module a pre-made customer. It
> is not: declaring `cloud.billing` makes it a managed path, after which
> `writeCloudConfig` refuses the billing writer with `FIELD_MANAGED`, the
> webhook handler throws, and **every delivery 500s and retries forever**.
> Nothing needs this now that the scope is new tenants only; it is recorded
> so nobody rediscovers it as an idea.

### What a lite seat is

**There is no lite-seat class in the product today.** That is a finding, not
an omission on my part, and it is the single most important caveat in this
document. Every custom RBAC role deliberately rides `principal.role = 'member'`
(`principal.service.ts`: *"Custom role grants ride the member role"*), so the
seat predicate above cannot tell an Owner from a read-only custom role. There
are four system presets — Owner, Admin, Manager, Contributor — and all four
are operator-grade. No viewer role exists anywhere in the catalogue.

A cheaper seat therefore has to be **derived**.

**Operator decision.** *"A lite seat is read-only on the customer support
side."* So the derivation is:

> **A lite seat is a teammate who holds no write permission on the
> customer-support surface** — conversations, tickets and the inbox —
> regardless of what they can do elsewhere.

Full seats are support agents; lite seats are everyone else who needs
visibility. So a product manager who writes freely on feedback boards and
roadmaps but only *observes* the support inbox is a **lite** seat. That is the
case worth stating, because it is the one the two readings disagree about.

| Reading | A PM who writes on boards, reads the inbox | Status |
| --- | --- | --- |
| **Support-scoped** — no write on conversations / tickets / inbox | **lite** | **chosen** |
| Globally read-only — writes nothing anywhere | full | alternative |

Reversing it is one edit: widen `SUPPORT_SURFACE_CATEGORIES` in
`permission-classes.ts` to every catalogue category. The tests are written so
that doing so turns five of them red with the reasons named, rather than
passing quietly under a different commercial model.

Effective permissions are resolved exactly as the authorization layer resolves
them (`permissionsForPrincipal`): workspace-wide role assignments if the
principal has any, the legacy preset otherwise. Team-scoped assignments are
excluded, because they narrow access inside a team rather than conferring it.

Three properties this buys:

- **It is not gameable.** To get the reduced rate you must genuinely withhold
  every support-side write. A flag on the role would be free to set; this is
  not.
- **It is invisible on existing installs.** Both legacy presets carry write
  permissions, so a workspace that has never adopted custom roles has zero
  lite seats and its bill does not change the day the definition ships.
- **It moves on its own.** Grant a viewer one write permission and the next
  reconcile bills them at the full rate.

**The surface is derived from the catalogue, the split within it is
explicit.** `SUPPORT_SURFACE_CATEGORIES` names the catalogue categories that
constitute customer support (`conversation`, `support`), plus a short
`SUPPORT_SURFACE_EXTRAS` list for permissions filed elsewhere that still act
there — today only `copilot.use`. Within that surface, read and write are two
enumerated lists, not a `.view` suffix test: the RBAC catalogue's own header
forbids prefix filters, and a suffix test misfiles `post.view_private` (read),
`copilot.use` (an agent tool) and `status_page.publish` (a write).

A test asserts the two lists partition the derived surface exactly, so a
permission added to a support category fails CI until someone classifies it
rather than silently landing in whichever bucket over- or under-charges.

Two judgement calls inside the surface, both reversible in one line:

- **`copilot.use` counts as a support write.** The firm reason is not that it
  drafts replies but that it **spends metered AI budget on the support
  surface**: a seat that can consume the workspace's AI spend is not what the
  lite rate is for. The counter-case is self-defeating anyway — Copilot's
  output is a draft reply, so `copilot.use` without `conversation.reply` is a
  role nobody builds deliberately, and classifying it read-only opens the
  cheapest gaming route there is: grant Copilot, withhold reply, pay lite, have
  a full-rate colleague paste the draft.

  A useful consequence falls out of this: because `copilot.use` is a support
  write, **`lite ⇒ !copilotEligible` is a theorem**, so billing the add-on on
  `seats.full` can never charge for someone ineligible. It is pinned by a test
  rather than left as a coincidence.
- **`assistant.manage` counts as a support write too.** *(Operator decision,
  after being raised as an open question.)* The rule already applied to
  `sla.manage`, `routing.manage` and `workflow.manage` decides it — *"none
  touches a single conversation directly, but each decides what happens to
  every conversation"* — and `assistant.manage` gates the agent's persona,
  guidance, custom actions and knowledge, which is what every customer is
  automatically told. It also gates the Copilot configuration surface, so
  keeping it out would have left the module calling *using* Copilot a support
  write and *configuring* it not one.

  The discriminating case is an "AI operations" role holding inbox reads plus
  `assistant.manage` and nothing else: it is a **full** seat, and there is a
  test that goes red if the entry is removed from either the extras list or
  the write list.

### One derivation, not two

`billableQuantities(seats, prices)` is the single expression that decides what
every meter is charged. Checkout and every subsequent sync both call it.

That is a correction, and the way it went wrong is worth keeping. Checkout used
to floor the seat line to `Math.max(1, full)` — so a subscription is never
created with a zero quantity on its only licensed item — while the sync used a
bare `full`. The two agree at every value except zero, and zero stopped being
hypothetical the moment "lite" was narrowed to the customer-support surface: an
**all-lite workspace** (a feedback-only install that has adopted custom roles)
is now an ordinary configuration. Such a workspace bought one full seat and one
Copilot seat at checkout, and the very first webhook pushed both to zero —
either rejecting the update and 500ing the webhook forever, or charging and
crediting a seat nobody occupied.

Two tests each asserted one half of that contradiction — one that the add-on
matched the seat quantity *at the floor*, one that lite seats are excluded from
the add-on — and neither could see the other. **Two tests can each be right and
jointly describe an impossible system.** The property test that would have
caught it asserts the two paths agree *across a range of seat shapes*, and it
now exists.

The floor is gone rather than duplicated. Billing one seat where nobody occupies
one is a phantom charge, and "bills per paid user" cannot mean "bills 1 when
there are no paid users"; a plan minimum, if the operator wants one, belongs in
the plan. Two consequences follow, both handled:

- **A checkout could otherwise have no licensed line at all**, on a plan that
  sells no lite seat. So `billableQuantities` takes the plan's prices: **a plan
  with no lite price has no lite seats**, and counts every teammate as full.

  *(Operator decision — recorded so it is not relitigated.* You cannot bill
  someone at a rate that does not exist. The alternatives are free riders, or
  refusing to let the person exist, and both are worse. The oddity — that the
  same teammate can be a lite seat on one plan and a full seat on another — is
  largely cosmetic, because a plan without a lite SKU is usually `free`, which
  costs nothing.)*
- **A seat class with a zero quantity at checkout has no subscription item**,
  and the sync used to skip any meter without one — so the first support agent
  hired by an all-lite workspace would never have been billed. The sync now
  *creates* a missing seat item, bounded to meters the plan sells and
  **never** to the opt-in add-on, which is bought at checkout or not at all.

### Creation only when the catalogue accounts for everything

Creating an item is the one place this module can invent a charge, so it
carries a guard the update path does not need.

`toSnapshot` resolves each item's meter by looking its price up in the
catalogue. An item whose price is in **no** plan therefore resolves to nothing
— and "resolves to nothing" used to be indistinguishable from "there is no
item". That is not an exotic state: a price's amount is **immutable** at the
provider, so *any* repricing mints a new price object and retires the old one,
while live subscriptions keep billing under the retired id. The sync would see
no lite item, create one at the new price, and the customer would pay for the
same seats twice on the same invoice, indefinitely. The blast radius is the
existing book at the moment of a repricing — exactly when a duplicate line is
least tolerable.

So unresolved items are **recorded rather than dropped**
(`SubscriptionSnapshot.unaccountedItems`), and creation is refused while any
*licensed* one is present. Three things about the shape:

- **Refusal is the only correct guard here.** Matching an existing item by
  price would not help: the price about to be created is precisely the one the
  subscription does not carry.
- **Updates continue.** A stale line is a reason not to add, not a reason to
  freeze; the items that did resolve still track the product's seat count, or a
  repricing would silently stop all seat billing until someone noticed.
- **The lookup rule is untouched.** `toSnapshot` looks each item up under *its
  own* plan, which is what makes a downgrade leave an orphaned item resolvable.
  Only the disposal of a genuinely unresolvable item changed.

A metered item is marked `licensed: false` and does not block, since it carries
no quantity and cannot become a second seat charge. An item whose `usage_type`
the provider did not report is treated as licensed — guessing "metered" wrongly
costs a duplicate charge, guessing "licensed" wrongly costs a skipped creation.

### An unresolvable plan holds, it does not fall to Free

The same repricing trigger has a worse consequence than a duplicate line.
`planForPrice` resolves a subscription's plan from its prices, so a
subscription billing entirely under retired prices resolves to **no plan** —
and `null` used to read as "not on a plan", writing Free. A paying customer
lost every entitlement in the product on the next webhook while still paying
the old price at the provider.

`applySubscription` now holds the last known plan instead, under three
conditions, each of which keeps the hold narrow:

1. the subscription resolves to no plan, **and**
2. it carries a licensed item the catalogue cannot account for, **and**
3. its status still entitles a plan, **and** there is a stored plan to hold.

The stored plan is read through `requireSettings()`, deliberately **not**
`getCloudConfig()`. That helper fails *open* — a settings-read error resolves
to the disabled config, whose plan is null, which here would read as "nothing
to hold" and downgrade the customer to Free through a different door. Failing
open is right for an entitlement *check*, which gates commerce; it is wrong
where the read decides what someone is charged. So the read may throw, the
webhook releases its claim and answers 500, and the provider redelivers.

**The discriminator is (2), not (1).** A genuine downgrade or cancellation also
yields no plan, and falling to Free is exactly right there — the difference is
that such a subscription's items all resolve, so `null` is evidence about the
customer rather than about the catalogue. Condition (3) is what stops a
cancelled customer keeping their entitlements when *both* problems coincide,
and it is the only reachable path to that branch: a subscription whose prices
resolve returns before the status is ever consulted.

### The frozen state is on the billing page, not only in logs

`getBillingOverview()` reports `catalogueDrift`, recomputed from the same
snapshot mapping the sync uses so the page cannot claim a healthy catalogue
while the sync is refusing to create. It has **three** states, not two:

| state | meaning |
| --- | --- |
| `ok` | fetched, and every price is in the catalogue |
| `drifted` | fetched, with counts of unaccounted licensed and metered items and whether the plan is unresolvable |
| `unknown` | the provider could not be reached, so drift **cannot be determined** |

`unknown` exists because the check needs a provider fetch and an outage is
exactly when someone opens this page. Collapsing it into "no drift" would make
*"could not check"* render identically to *"checked, all fine"* — the wrong
direction for a warning surface, and there is no persisted record to fall back
on. (`null` is reserved for "this workspace has no subscription".)

It is surfaced rather than logged because the failure is **invisible to the
only party who can fix it**: a repricing fires across the whole book at once,
and nobody watches a per-tenant pod's warn stream. Counts only — no item id and
no price id, because those are provider references and
`no-client-leak.db.test.ts` asserts none reaches the client.

Note what the freeze is and is not: it is a **deferral, not a loss**. Once the
catalogue is back in step the blocked creation happens on the next sync, and
because the creation branch never consults `syncedQuantities`, a stale record
from the frozen period cannot poison it.

### Nothing is pushed to a subscription that does not entitle its plan

`syncSeats` returns early unless `entitlesPlan(snapshot)`. The provider sends
`customer.subscription.updated` carrying `canceled` **before** it sends
`.deleted`, and refuses updates to a canceled subscription — so without the
guard the push throws, the handler answers 500, and the delivery redelivers
until the deletion lands. No wrong bill, because `applySubscription` has
already written the downgrade; it is retry noise and error-log churn over a
state the module already knows the answer to. The predicate is exported from
`subscription.ts` rather than restated, so the entitling-status list exists
once.

### Copilot

**Operator decision.** *"Copilot bills per paid user/month."*

So the billed quantity is **full seats** — not the number of teammates holding
`copilot.use`. That permission still decides who may *use* Copilot
(`assistant/copilot-gate.ts` is untouched), but it no longer decides what is
charged. `SeatCounts.copilotEligible` reports it for the admin surface and is
named so it cannot be mistaken for a billing figure.

> **Assumption, stated so it is cheap to reverse: lite seats are excluded.**
> A read-only support viewer has no write action for Copilot to assist, so
> charging them for a capability they cannot exercise would be wrong. If the
> operator wants Copilot billed on every paid user including lite seats, it is
> `fullSeat` -> `seats.total` in `billableQuantities()` — **one place**, which
> is the point of the next section.

**The purchase stays opt-in**, and the opt-in is load-bearing: because the
add-on bills per paid user, adding the line automatically would charge for the
whole team on the first upgrade without the customer choosing it.
`checkoutLineItems()` adds it only when the caller passes `addOns.copilot`,
and the admin control defaults to unchecked while stating what it would cost.

The asymmetry with `syncSeats()` is deliberate: the sync only ever adjusts an
item the subscription already has, so it cannot introduce a charge. Purchase
happens at checkout and nowhere else.

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
claim, the API response is the fact.

A cheap **payload pre-filter** runs before the re-fetch, purely to protect
provider quota: without it every workspace spends a subscription fetch on
every event belonging to every other workspace, which is N-times amplification
against a per-account rate limit that grows with the fleet. It reads the
payload, so it can only *refuse*, never approve — a payload claiming our
customer still reaches the authoritative check. A foreign event is acknowledged (200,
`handled: false, foreign: true`) and recorded as consumed — a non-2xx would
make the provider retry it forever — and logged at `warn`.

### Adoption: the case with nothing local to compare against

A workspace with **no** recorded customer cannot answer the ownership question
locally, because checkout completes at the provider before any reference
exists here. Rejecting outright would make self-serve signup impossible, so
the question is answered **at the provider** instead: `ensureCustomer()`
stamps this workspace's id into the customer's metadata
(`WORKSPACE_STAMP_KEY`), and adoption requires that stamp to match.

A customer created outside this module carries no stamp and is refused, with a
`warn` naming the reference. That is the right direction for an identity
question — unlike an entitlement read, which fails *open* because it gates
commerce, this gates who gets billed, so a failed customer lookup refuses too.
The contract for a provisioning flow that wants to hand this module a
pre-made customer is one metadata key. Given the new-tenants-only scope above,
nothing needs that today.

A customer lookup that **fails** is deliberately not the same as a stamp that
does not match. A mismatch is definitive — the event is foreign, acknowledged
and consumed. A transient lookup error is not an answer at all, so it is left
to throw: the handler's error path releases the claim and answers 500, and the
provider redelivers. Swallowing it as "foreign" would consume a workspace's
own first subscription on a provider blip, with no retry.

**Two ways this window was reopened after it had closed**, both fixed, both
worth stating because the second was self-inflicted by the fix for something
else:

1. `applySubscription(null, …)` used to null `customerRef` along with the
   subscription, so **every cancellation** returned the workspace to "no
   customer known" — permanently adoptable. A null snapshot now clears the
   subscription and keeps the customer, which is also just correct: a provider
   customer outlives every subscription it holds, and destroying the reference
   throws away the "which account is this" answer support needs most.
2. The reconcile sweep called that same null-apply on every workspace without
   a live subscription — so the mechanism added to make a missed webhook
   recoverable was erasing the identity the ownership check depends on, every
   fifteen minutes, for the whole free population. The sweep now leaves a
   known-customer workspace alone (see below).

### Three more details worth stating

- **The signature's timestamp tolerance is transport anti-replay, not
  idempotency.** A legitimate redelivery inside the window is a valid,
  correctly-signed duplicate; only the event ledger stops it.
- **A failed handler releases its claim**, and a *stale* one is reclaimed
  after `CLAIM_LEASE_MS`. The normal error path deletes the claim row; a pod
  kill, an OOM or a failing release cannot, so the claim upsert also reclaims
  any row that is unprocessed and older than the lease. Without that second
  half, an interrupted delivery was answered "duplicate" forever while nothing
  had ever been applied.
- **The lease reduces duplicate work; it does not exclude it.** A handler
  parked in a slow provider call past the window is indistinguishable from a
  dead one, so a redelivery at `CLAIM_LEASE_MS + 1s` reclaims it and both run.
  That is inherent to leasing on a timeout rather than on liveness. What makes
  the overlap safe is idempotence *underneath* the lease — no-op write seams,
  the snapshot ordering guard, per-subscription synced quantities, and
  provider-side dedupe keys on usage. Do not add a step that relies on the
  lease for correctness.
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

One case it deliberately does **not** resolve: a workspace with a known
customer and no locally-recorded subscription. That is ambiguous — either they
cancelled, or a subscription exists at the provider this workspace has lost
track of — and asserting Free from a timer resolves it by downgrading someone
who may well be paying. The sweep logs and leaves the plan alone; the webhook
path handles real transitions. (Resolving it properly means asking the
provider which subscriptions the customer has, which needs a list endpoint
this client does not have yet.)

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
  product does not model it — which is why a *redundant* push is not free, and
  why the synced-quantity comparison is keyed per subscription rather than
  read off whichever state row is newest.
- **`CLAIM_LEASE_MS` is a guess with a rationale, not a measurement.** Five
  minutes against a handler whose duration under a slow provider has not been
  measured. Too short duplicates work; too long delays recovery. Two handlers
  that do overlap both push the same seat quantities under an **identical
  idempotency key**, so the provider collapses the second — the overlap is
  absorbed at the provider, not merely semantically equivalent.
- **`syncSeats` reads then writes.** Two overlapping handlers can both read
  the synced quantities before either writes them. Harmless in effect for the
  reason above, but it is a read-modify-write where a single conditional write
  would be stronger.
