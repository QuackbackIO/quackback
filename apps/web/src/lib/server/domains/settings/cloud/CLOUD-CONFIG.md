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

| Key            | Chokepoint                                                                                                            | Why it is a plan boundary                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customDomain` | `help-center/help-center-domain.service.ts` → `setHelpCenterDomain`                                                   | Standard paid boundary. `tier_limits.features.customDomain` has existed since tier limits shipped and **was never enforced anywhere** — this closes a hole the schema already declared                                  |
| `sso`          | `functions/sso.ts` → `upsertIdentityProviderFn`                                                                       | Classic enterprise boundary. Runtime _registration_ already reads `features.customOidcProvider`, but provider CRUD was ungated                                                                                          |
| `aiAssistant`  | `assistant.orchestrator.ts`, `assistant/copilot-gate.ts`                                                              | The two entry points for the customer-facing agent and inbox Copilot. Distinct from `aiTokensPerMonth`: the budget answers "how much", this answers "at all"                                                            |
| `aiInsights`   | The `enforceAiTokenBudget()` family — summaries, sentiment, merge suggestions, auto-tagging, attribute classification | One coherent family, all already funnelling through one helper                                                                                                                                                          |
| `workflows`    | `workflows/workflow.service.ts` → `createWorkflow`                                                                    | The authoring chokepoint. Note: there is **no simple/advanced split** in the engine, so the entitlement is `workflows`, not `advancedWorkflows` — naming it "advanced" would imply a distinction the code does not have |
| `apiAccess`    | `domains/api/auth.ts` → `withApiKeyAuth`                                                                              | The single seam every `/api/v1/*` route passes through                                                                                                                                                                  |
| `mcpServer`    | `lib/server/mcp/handler.ts`                                                                                           | Gated today only at config-_write_ time, not at request time                                                                                                                                                            |
| `webhooks`     | `domains/webhooks/webhook.service.ts`                                                                                 | Already tier-gated; the entitlement adds the plan name to the refusal                                                                                                                                                   |
| `auditLog`     | `functions/audit-log.ts` → `listAuditEventsFn`                                                                        | Retention/visibility is a standard enterprise boundary                                                                                                                                                                  |

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

`PLAN_IDS` is a closed set (`free`, `pro`, `business`, `enterprise`). Closed on
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
— `auditLog` says Business, not Enterprise. When an override denies something
the workspace's own plan grants, there is no upgrade that fixes it, so the
refusal reports no required plan and the copy degrades to "contact us" rather
than selling a plan the customer already has.

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
whole-block `cloud` lock the way `tierLimits` is locked. A whole-block lock
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
    plan: business
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
