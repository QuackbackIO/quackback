# Cloud config: plans and entitlements

`settings.cloud` is a nullable `jsonb` column holding a plan id, a sparse map of
feature entitlements, and opaque billing references. It is **disabled by
default** and inert on every install that does not explicitly configure it.

```jsonc
{
  "enabled": true,
  "plan": "pro",
  "entitlements": { "sso": true }, // sparse overrides on the plan's defaults
  "billing": { "provider": "…", "customerRef": "…", "subscriptionRef": "…" },
  "source": "config", // which writer wrote last
  "updatedAt": "2026-08-08T00:00:00.000Z",
}
```

## Why this exists

`settings.tier_limits` answers _how much_: `maxBoards`, `aiTokensPerMonth`,
`apiRequestsPerMinute`. It carries no notion of **which plan produced those
numbers**, so the product can say _"you have hit a limit"_ but never _"that is a
Pro feature"_. There is no feature gating that can name a plan, no upgrade
prompt with a target, and no way to explain a downgrade after the fact.

This block adds the missing dimension. Nothing about numeric enforcement moves:
`getTierLimits()` and the helpers in `tier-enforce.ts` are byte-for-byte
unchanged, and `requireEntitlement()` sits _beside_ them rather than in front.

```ts
await requireEntitlement('aiAssistant') // does the plan include it?
await enforceAiTokenBudget() // is there budget left?
```

## What an unconfigured install experiences

Nothing. Concretely, with `settings.cloud` NULL — the value every existing row
has after the migration, and the only value a self-hosted install ever has:

|                                | Behaviour                                                    |
| ------------------------------ | ------------------------------------------------------------ |
| Numeric limits                 | Unlimited (`OSS_TIER_LIMITS`, unchanged)                     |
| Plan                           | None. `getCloudConfig().plan` is `null`                      |
| `requireEntitlement(anything)` | Returns. Never throws                                        |
| `hasEntitlement(anything)`     | `true`                                                       |
| Upsell / billing surfaces      | None rendered, nothing to render from                        |
| Extra queries per request      | Zero. The read rides the existing Redis-cached settings blob |
| New module-scope cache         | None                                                         |

The mechanism is a single early return in `isEntitled()`: `if (!config.enabled)
return true`, checked **before** any stored value is consulted. So a
half-written row that denies every entitlement but leaves `enabled` off still
grants everything. `resolveCloudConfig()` reinforces it from the other side —
anything that is not an explicit, well-formed `enabled: true` (a NULL, an empty
object, a hand-edited row, a shape written by a newer schema) resolves to the
frozen `DISABLED_CLOUD_CONFIG`.

`cloud-default-off.test.ts` demonstrates this rather than asserting it: every
case iterates the live `ENTITLEMENT_KEYS`, so an entitlement added next year is
covered without anyone remembering to add a case.

## The entitlement catalogue, and why these

An entitlement earns a place only if the product has a **single server-side
chokepoint** where the gate can sit. Without one, a "feature" is a marketing
bullet and gating it means scattering half-checks that drift apart. The
catalogue below was derived by auditing the codebase, not by picking plausible
names.

| Key            | Chokepoint                                                                        | Why it is a plan boundary                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customDomain` | `help-center/help-center-domain.service.ts` → `setHelpCenterDomain`               | Standard paid boundary. `tier_limits.features.customDomain` has existed since tier limits shipped and **was never enforced anywhere** — this closes a hole the schema already declared                                  |
| `sso`          | `functions/sso.ts` → `upsertIdentityProviderFn`                                   | Classic enterprise boundary. Runtime _registration_ already reads `features.customOidcProvider`, but provider CRUD was ungated                                                                                          |
| `aiAssistant`  | `assistant.orchestrator.ts`, `assistant/copilot-gate.ts`                          | The two entry points for the customer-facing agent and inbox Copilot. Distinct from `aiTokensPerMonth`: the budget answers "how much", this answers "at all"                                                            |
| `aiInsights`   | `summary/summary.service.ts` (post summaries), `sentiment/sentiment.service.ts`   | Reading what customers said in bulk. Split from `aiDrafts` because the two sit on different plans, and one key cannot hold two levels                                                                                   |
| `aiDrafts`     | `assistant/copilot-gate.ts` → `gateCopilotAguiRequest`, `macros/macro.service.ts` | Drafting help for teammates answering in the inbox, and the macro library those drafts insert from                                                                                                                      |
| `workflows`    | `workflows/workflow.service.ts` → `createWorkflow`                                | The authoring chokepoint. Note: there is **no simple/advanced split** in the engine, so the entitlement is `workflows`, not `advancedWorkflows` — naming it "advanced" would imply a distinction the code does not have |
| `apiAccess`    | `domains/api/auth.ts` → `withApiKeyAuth`                                          | The single seam every `/api/v1/*` route passes through                                                                                                                                                                  |
| `mcpServer`    | `lib/server/mcp/handler.ts`                                                       | Gated today only at config-_write_ time, not at request time                                                                                                                                                            |
| `webhooks`     | `domains/webhooks/webhook.service.ts`                                             | Already tier-gated; the entitlement adds the plan name to the refusal                                                                                                                                                   |
| `auditLog`     | `functions/audit-log.ts` → `listAuditEventsFn`                                    | Retention/visibility is a standard enterprise boundary                                                                                                                                                                  |

Deliberately **excluded**:

- **`ipAllowlist`** — `tier_limits.features.ipAllowlist` exists but there is no
  implementation to gate. Adding an entitlement for it would be inventing a
  feature.
- **Product surfaces** (help centre, status page, changelog, roadmap, tickets,
  visitor analytics) — these already have DB-backed feature flags in
  `settings.feature_flags`. Those answer a different question: _has the admin
  turned it on_, self-service, flippable by any admin. Entitlements answer _is
  the plan allowed to_. Conflating them would mean a self-hoster's Labs toggle
  and a billing decision writing the same field. They stay orthogonal; a
  product surface can gain an entitlement later without moving its flag.
- **Seats, boards, posts, custom roles, status components** — already numeric
  limits. An entitlement would duplicate them badly.

### Relationship to `tier_limits.features`

Where a catalogue entry overlaps an existing `TierFeatureFlags` key, it records
it as `tierFeature`. The two layers are complementary:

- `assertTierFeature(k)` — _has the operator capped this workspace?_ Reads
  `settings.tier_limits`. Unchanged.
- `requireEntitlement(k)` — _does this workspace's plan include it?_ Reads
  `settings.cloud`. New.

A call site may use either or both; both refuse with HTTP 402, and only the
entitlement one can name a plan. `enforcement-untouched.test.ts` pins the
direction of the dependency: entitlements may read tier limits, tier limits must
never read entitlements.

## Plans

`PLAN_IDS` is a closed set (`free`, `growth`, `pro`, `scale`), ranked 0 to 3 in
that order. Closed on
purpose: the whole value of modelling a plan is that the product can rank it,
name it in a refusal, and derive what it grants. A free-form string can do none
of those. A negotiated or grandfathered workspace is expressed as an explicit
entitlement override on a catalogue plan, never as a bespoke plan id.

Resolution order in `isEntitled()`:

1. Cloud disabled → granted.
2. Explicit override in `entitlements[key]` → that value.
3. The plan's `grants` list.
4. Enabled with no plan → **denied**. Unreachable through the config file
   (the schema rejects `enabled: true` without a plan), so this is the
   hand-edited-row case, and failing closed is right once the switch is on.

The refusal names the **cheapest** plan that grants the feature, not the largest
— `mcpServer` says Growth, even though Pro and Scale include it too. When an
override denies something
the workspace's own plan grants, there is no upgrade that fixes it, so the
refusal reports no required plan and the copy degrades to "contact us" rather
than selling a plan the customer already has.

## Trials

A workspace that finishes setting up on a cloud-enabled deployment, and has no
subscription, is lent a paid plan for a fortnight. The whole mechanism is one
record and one rule.

```jsonc
"trial": { "plan": "pro", "startedAt": "…", "endsAt": "…" }
```

**The stored plan is never touched.** It stays `free` for the entire trial, and
`resolveCloudConfig()` prefers the trial's plan while the trial is in date.
Three things follow, and each is a bug that then does not have to be written:

- **A trial ends with no job and no lag.** Nothing runs at `endsAt`; the row
  already describes the workspace after the trial, and the next read simply
  stops preferring it. The workspace-settings cache does not delay it either,
  because the cache holds the stored row and the comparison happens after the
  read.
- **A trial cannot be restarted.** The record outlives the trial it describes,
  so a second attempt finds it and hands out nothing. The window is also
  derived from the workspace's stamped setup-completion time rather than from
  the clock at the moment of the call, so a retry recomputes the identical
  block and the write seam collapses it to a no-op.
- **Nothing else has to know.** Entitlements, refusal copy and the plan on
  screen all read `config.plan`, which is correct on both sides of the end.

Writing the trial into `plan` or into `billing.status` instead was tried on
paper and is actively destructive: both are reasserted from the subscription
(or from its absence) by the billing reconcile, so a trial recorded in either
is erased within minutes, silently, by a routine with no opinion about trials
at all.

Three conditions decide whether a recorded trial is in force. It has not run
out; the workspace has no subscription, because once there is one the
subscription decides; and it ranks **above** the stored plan, so a trial can
only ever add. That last one is what stops a workspace an operator pinned to
Scale being dropped onto a Pro trial for a fortnight.

**Ending a trial is a downgrade, not a lockout.** The plan becomes Free and the
gates below apply on their own. Signing in, reading the workspace's own data
and exporting it are not entitlements, are not gated, and do not change.

### Which writer owns it

Billing, and the config file wins if it ever claims the path — the same rule as
everything else in this block. Two specifics:

- `cloud.trial` is in `CLOUD_MANAGED_PATHS`, so `writeCloudConfig()` refuses a
  non-config writer whenever the path (or a `cloud` ancestor) is claimed. That
  refusal is recorded and swallowed: setup completing is a request a human is
  waiting on, and no workspace should fail to finish being built over a
  commercial courtesy.
- The config file's own vocabulary deliberately has no `trial` key. The file
  declares intent (`plan`, `entitlements`), and a trial is a window with two
  timestamps that nobody hand-writes. An operator who wants no trials pins the
  plan they do want.

`mergeCloudConfig()` carries the trial through explicitly. It has to: that
function builds its result field by field, so a field it does not name is
dropped rather than preserved, and both the config file's 30-second reconcile
and the billing sweep's empty-subscription write touch this column for reasons
that have nothing to do with a trial.

### A trial lends features, not quotas

`settings.tier_limits` is untouched by all of this, so a workspace trialing Pro
has Pro's **entitlements** and whatever **numeric limits** were last written
for it. That is a real seam, and it is deliberate in both directions.

Making it follow the trial would mean either writing the trial plan's numbers
into `tier_limits` — which nothing would ever write back, so the workspace
would keep the larger caps for good — or teaching `getTierLimits()` to consult
the plan, which is precisely the dependency `enforcement-untouched.test.ts`
exists to forbid. The chosen failure direction is the conservative one: a trial
can never inflate a quota and then leave it inflated.

### What a trialing workspace sees

The admin banner already driven by `settings.tier_limits.notice`. A trial
notice is **derived** from the config rather than written at trial start, so it
appears and expires with the trial and there is nothing left behind to clear.
An operator-set notice wins, because someone chose those words.

## Errors

`EntitlementRequiredError extends TierLimitError`. That inheritance is
load-bearing, not tidiness: every REST route, widget envelope and
AI-degradation path in the codebase already discriminates on `instanceof
TierLimitError` and maps it to 402 via `toResponseBody()`. Subclassing inherits
all of that plumbing without a second pass over every catch site, while the
payload gains what upsell needs:

```json
{
  "error": "entitlement_required",
  "limit": "entitlements.customDomain",
  "entitlement": "customDomain",
  "message": "Custom domains are a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.",
  "currentPlan": "free",
  "currentPlanName": "Free",
  "requiredPlan": "pro",
  "requiredPlanName": "Pro",
  "upgradeUrl": "https://…"
}
```

The `error` discriminator differs from `tier_limit_exceeded` so a client can
tell "buy a bigger plan" apart from "you are over a count".

## Two writers, one column

Today the declarative config file (`/etc/quackback/config.yaml`) is the only
writer. A billing module will be the second, deriving plan and entitlements from
a subscription. Three mechanisms keep them from fighting:

**1. Every write is a merge, never a replacement.** `mergeCloudConfig()` merges
sub-blocks field by field. A billing write that sets only
`billing.subscriptionRef` leaves a config-written `plan` untouched; a config
reconcile that declares only `plan` leaves the billing refs intact.

**2. Leaf-level managed paths.** The config file records what it declares in
`settings.managed_field_paths` — `cloud.plan`, `cloud.entitlements`,
`cloud.billing`, `cloud.enabled`, `cloud.upgradeUrl` — deliberately **not** a
whole-block `cloud` lock the way `tierLimits` is locked. (`cloud.trial` is a
recognised path but has no key in the file's schema; see Trials above.) A whole-block lock
would stop the billing module recording a subscription reference the file never
claimed.

**3. One write seam that enforces the lock.** `writeCloudConfig(patch, {writer})`
is the only mutation path. A writer other than `config` is refused any path the
file has claimed. So if an operator pins `cloud.plan` in the config file, a
billing webhook cannot quietly move the workspace to a different plan; if the
operator does not pin it, billing owns it.

**The file wins where it declares. The other writer owns everything else.**
That is the spirit of the original "one mechanism for self-hosters and cloud
workspaces" principle preserved — the writer varies, the enforcement path does not.

Removing the block from the config file releases the lock but **does not clear
the stored plan**. Unlocking the UI and downgrading a workspace are different
operations and the file should not conflate them.

`source` and `updatedAt` are stamped on every write, so "why did this workspace
lose that feature" has an answer in the row itself. The reconciler's idempotence
check ignores those two fields, otherwise the 30-second poll would rewrite the
row and bust the settings cache forever.

## Config file example

```yaml
apiVersion: quackback.io/v1
kind: QuackbackConfig
spec:
  cloud:
    enabled: true
    plan: pro
    entitlements:
      sso: true # negotiated, above the plan's defaults
    upgradeUrl: https://example.com/billing
  tierLimits: # unchanged, still the numeric channel
    maxBoards: 25
```

## Known tradeoffs

- **The read fails open.** If the settings read throws, `getCloudConfig()`
  returns the disabled config and logs an error rather than propagating. On a
  self-hosted install that is simply today's behaviour preserved through an
  outage. On a cloud workspace it means a broken settings read _grants_ rather than
  denies. That is the right direction for a commercial gate — an entitlement is
  not an authorization boundary, and under a settings-read failure every gated
  feature is broken anyway — but it is a real fail-open and should be revisited
  if entitlements ever gate something security-relevant.
- **Two gates can cover one feature.** `customDomain`, `sso`, `mcpServer` and
  `webhooks` exist in both `tier_limits.features` and the entitlement catalogue.
  That is deliberate (they answer different questions) but it is two places to
  look. The eventual consolidation is for the operator cap to be expressed as an
  entitlement override, at which point `tier_limits.features` can shrink.
- **Only two gates are wired.** `customDomain` and `sso` are gated at their
  chokepoints. The remaining seven catalogue entries are documented but not yet
  enforced — the `chokepoint` field on those entries names _where the gate will
  go_, not where one is, and only the two wired entries describe live code. Each
  is a one-line `await requireEntitlement(k)`, and each should land with its own
  test rather than in a bulk sweep.
- **`aiAssistant` needs care when it is wired.** Both of its named chokepoints
  already gate on the `inboxAi` feature flag, so a naive addition would put an
  admin's Labs toggle and a plan entitlement on the same line — the exact
  conflation the exclusion rule above exists to prevent. Gate it upstream of the
  flag check, or gate a different seam.

## `CLAUDE.md` needs amending

`CLAUDE.md` currently states _"The OSS code is unaware of 'cloud' as a concept,
so limits and their writer are the same mechanism for self-hosters and cloud
workspaces."_ That principle is deliberately relaxed by `SAAS-HOSTING-STACK.md`
§8.1 and this implementation. The rule should be updated to describe the two
layers — numeric limits in `settings.tier_limits`, plan and entitlements in
`settings.cloud`, default off — when this branch lands.
