/**
 * Cloud configuration: plans, entitlements and billing references.
 *
 * ## What this is, and what it is not
 *
 * `settings.tier_limits` answers *how much* — a bag of numbers (`maxBoards`,
 * `aiTokensPerMonth`, …) read by `getTierLimits()` and enforced by the helpers
 * in `tier-enforce.ts`. It has no notion of which plan produced those numbers,
 * so the product can say "you have hit a limit" but never "that is a Pro
 * feature". Nothing here changes any of it: numeric enforcement is untouched
 * and this module never writes, reads or reinterprets `tier_limits`.
 *
 * This block answers *which plan, and what does it unlock* — the boolean layer
 * that makes feature gating and a named upgrade prompt possible.
 *
 * ## Disabled by default
 *
 * A `settings.cloud` value of NULL — the only value a self-hosted install ever
 * has, and the value every pre-existing row has after the additive migration —
 * resolves to {@link DISABLED_CLOUD_CONFIG}. With `enabled: false` every
 * entitlement reads as granted, `requireEntitlement()` never throws, there is
 * no plan and there is no upsell. That is byte-for-byte today's behaviour.
 *
 * ## Two writers
 *
 * Plan and entitlements are written either by the declarative config file
 * (`/etc/quackback/config.yaml`, reconciled by `lib/server/config-file/`) or,
 * later, by a billing module deriving them from a subscription. They never
 * fight because the config file records what it declares in
 * `settings.managed_field_paths`, and `writeCloudConfig()` refuses a
 * non-config writer any path that list covers. See CLOUD-CONFIG.md.
 */

import type { TierFeatureFlags } from '../tier-limits.types'

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * Plan identifiers the product can reason about.
 *
 * Deliberately a closed set rather than free-form strings: the whole point of
 * modelling a plan is that the product can rank it, name it in a refusal, and
 * derive what it grants. A free-form string can do none of those. Operators who
 * need a bespoke arrangement express it as explicit entitlement overrides on
 * top of a catalogue plan, not as a new plan id.
 */
export const PLAN_IDS = ['free', 'growth', 'pro', 'scale'] as const

export type PlanId = (typeof PLAN_IDS)[number]

export interface PlanDefinition {
  id: PlanId
  /** Display name used verbatim in refusal copy and upgrade prompts. */
  name: string
  /**
   * Ordering only. Used to pick the *cheapest* plan that grants an
   * entitlement, so a refusal names the smallest upgrade that would work.
   */
  rank: number
  /**
   * Indefinite article for {@link name} in refusal copy ("a Pro feature",
   * "an Advanced feature"). Declared rather than derived: an initial-vowel
   * test is wrong for names like "Unlimited" ("an Unlimited plan") and
   * "One" ("a One plan"), and there are only a handful of plans. Every plan
   * in today's catalogue happens to take "a".
   */
  article: 'a' | 'an'
  /** Entitlements this plan grants by default. */
  grants: readonly EntitlementKey[]
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/**
 * The entitlement catalogue.
 *
 * Inclusion rule: an entitlement earns a place here only when the product has
 * a *single server-side chokepoint* where the gate can sit. Anything without
 * one is a marketing bullet, not an entitlement, and gating it would mean
 * scattering half-checks that drift apart. Every `chokepoint` below is a real
 * path in this repo.
 *
 * `tierFeature` records the pre-existing {@link TierFeatureFlags} key covering
 * the same feature, where one exists. The two layers are complementary, not
 * duplicated: `assertTierFeature()` answers "has the operator capped this
 * workspace", `requireEntitlement()` answers "does this workspace's plan
 * include it". A call site may use either or both; both refuse with a 402,
 * only the entitlement one can name a plan.
 */
export const ENTITLEMENTS = {
  customDomain: {
    friendly: 'Custom domains',
    plural: true,
    tierFeature: 'customDomain',
    chokepoint:
      'lib/server/domains/help-center/help-center-domain.service.ts (setHelpCenterDomain)',
  },
  sso: {
    friendly: 'Single sign-on',
    plural: false,
    tierFeature: 'customOidcProvider',
    chokepoint: 'lib/server/functions/sso.ts (upsertIdentityProviderFn)',
  },
  /**
   * Not wired: the customer-facing half (the orchestrator) and the
   * teammate-facing half (the Copilot gate) are two seams, and the second one
   * already carries {@link ENTITLEMENTS.aiDrafts}. Wiring this key wants a
   * decision about which surfaces each of the two AI keys owns, not another
   * gate on the same line.
   */
  aiAssistant: {
    friendly: 'The AI assistant',
    plural: false,
    tierFeature: null,
    chokepoint:
      'not wired: lib/server/domains/assistant/assistant.orchestrator.ts, lib/server/domains/assistant/copilot-gate.ts',
  },
  /**
   * Post summaries and sentiment. Deliberately *not* the drafting half of the
   * AI feature set: see {@link ENTITLEMENTS.aiDrafts}, which is included a
   * tier earlier, so one key could not have covered both.
   */
  aiInsights: {
    friendly: 'AI insights',
    plural: true,
    tierFeature: null,
    chokepoint:
      'lib/server/domains/summary/summary.service.ts (generateAndSavePostSummary), lib/server/domains/sentiment/sentiment.service.ts (analyzeSentiment)',
  },
  /**
   * Drafting help for teammates answering in the inbox, and the macro library
   * those drafts insert from.
   */
  aiDrafts: {
    friendly: 'AI drafts',
    plural: true,
    tierFeature: null,
    chokepoint:
      'lib/server/domains/assistant/copilot-gate.ts (gateCopilotAguiRequest, the shared gate for the drafting routes), lib/server/domains/macros/macro.service.ts (listMacros, createMacro)',
  },
  workflows: {
    friendly: 'Workflows',
    plural: true,
    tierFeature: null,
    chokepoint: 'lib/server/domains/workflows/workflow.service.ts (createWorkflow)',
  },
  /**
   * The one seam named here that is not yet wired, and deliberately so:
   * `withApiKeyAuth` runs on every REST API request and reads no workspace
   * settings today, so a gate there would add a settings read (a `kv_store`
   * row) to a per-request path on every install, including the self-hosted
   * ones the gate can never refuse. Wiring it wants either a process-lifetime
   * cache for the resolved config (the shape `getTierLimits()` already uses) or
   * a per-request memo, neither of which this key should introduce on its own.
   */
  apiAccess: {
    friendly: 'API access',
    plural: false,
    tierFeature: null,
    chokepoint: 'not wired: lib/server/domains/api/auth.ts (withApiKeyAuth)',
  },
  mcpServer: {
    friendly: 'The MCP server',
    plural: false,
    tierFeature: 'mcpServer',
    chokepoint: 'lib/server/mcp/handler.ts (handleMcpRequest, after auth)',
  },
  webhooks: {
    friendly: 'Webhooks',
    plural: true,
    tierFeature: 'webhooks',
    chokepoint: 'lib/server/domains/webhooks/webhook.service.ts (createWebhook)',
  },
  auditLog: {
    friendly: 'The audit log',
    plural: false,
    tierFeature: null,
    chokepoint: 'lib/server/functions/audit-log.ts (listAuditEventsFn)',
  },
} as const satisfies Record<string, EntitlementDefinition>

export interface EntitlementDefinition {
  /** Feature name as it appears in refusal copy. Sentence-cased. */
  friendly: string
  /**
   * Whether {@link friendly} takes a plural verb ("Custom domains **are**"
   * vs "Single sign-on **is**"). Declared per entry rather than guessed from
   * the string: a trailing "s" is not a reliable plural marker ("API access",
   * "Single sign-on"), and this text is the one string the whole entitlement
   * layer exists to produce.
   */
  plural: boolean
  /** Matching `tier_limits.features` key, or null when there is none. */
  tierFeature: keyof TierFeatureFlags | null
  /**
   * Where the gate sits, or will sit. Documentation, not executable — kept
   * honest by review, and by a test per seam that drives the named entry point
   * on a plan that does and does not grant the key. An entry that reads
   * "not wired:" names a verified seam with no live gate, and says why in the
   * comment above it.
   */
  chokepoint: string
}

export type EntitlementKey = keyof typeof ENTITLEMENTS

export const ENTITLEMENT_KEYS = Object.keys(ENTITLEMENTS) as EntitlementKey[]

export function isEntitlementKey(value: string): value is EntitlementKey {
  return Object.prototype.hasOwnProperty.call(ENTITLEMENTS, value)
}

// ---------------------------------------------------------------------------
// Plan catalogue
// ---------------------------------------------------------------------------

/**
 * What each plan grants by default.
 *
 * This is a *default*, not the authority. The stored `entitlements` map wins
 * per key, so a grandfathered or negotiated workspace is expressed as an
 * override on a catalogue plan rather than as a bespoke plan id.
 */
export const PLAN_CATALOGUE: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    article: 'a',
    name: 'Free',
    rank: 0,
    grants: [],
  },
  growth: {
    id: 'growth',
    article: 'a',
    name: 'Growth',
    rank: 1,
    grants: ['customDomain', 'aiAssistant', 'aiDrafts', 'apiAccess', 'mcpServer', 'webhooks'],
  },
  pro: {
    id: 'pro',
    article: 'a',
    name: 'Pro',
    rank: 2,
    grants: [
      'customDomain',
      'aiAssistant',
      'aiDrafts',
      'aiInsights',
      'apiAccess',
      'mcpServer',
      'webhooks',
      'workflows',
    ],
  },
  scale: {
    id: 'scale',
    article: 'a',
    name: 'Scale',
    rank: 3,
    grants: [
      'customDomain',
      'aiAssistant',
      'aiDrafts',
      'aiInsights',
      'apiAccess',
      'auditLog',
      'mcpServer',
      'sso',
      'webhooks',
      'workflows',
    ],
  },
}

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = Object.values(PLAN_CATALOGUE).sort(
  (a, b) => a.rank - b.rank
)

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value)
}

/**
 * The cheapest plan granting `key`, or null when no catalogue plan does.
 *
 * This is what makes a refusal nameable: the message says "upgrade to Pro",
 * not "upgrade". Null is possible in principle (an entitlement granted only by
 * an explicit override) and the refusal copy degrades to "contact us" rather
 * than pretending a plan exists.
 */
export function minimumPlanFor(key: EntitlementKey): PlanDefinition | null {
  for (const plan of PLAN_DEFINITIONS) {
    if (plan.grants.includes(key)) return plan
  }
  return null
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const BILLING_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'paused'] as const

export type BillingStatus = (typeof BILLING_STATUSES)[number]

/**
 * Opaque references into whichever billing provider the operator uses. Shape
 * only — no provider SDK is wired, and none of these fields is read by any
 * enforcement path. They exist so the billing module has somewhere to record
 * what it reconciled from, and so support can answer "which subscription is
 * this workspace on" without a second system.
 */
export interface CloudBilling {
  /** Opaque provider identifier, or null when billing is not wired. */
  provider: string | null
  customerRef: string | null
  subscriptionRef: string | null
  status: BillingStatus | null
  /** ISO timestamp. */
  currentPeriodEnd: string | null
}

export const EMPTY_BILLING: CloudBilling = {
  provider: null,
  customerRef: null,
  subscriptionRef: null,
  status: null,
  currentPeriodEnd: null,
}

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

/**
 * A paid plan lent to a workspace that has not bought anything yet.
 *
 * Deliberately its own block rather than a value of {@link CloudBilling}
 * `status` or a write to {@link CloudConfig} `plan`, and both alternatives are
 * actively destructive:
 *
 * - `billing.status` and `billing.currentPeriodEnd` mirror a *provider*
 *   subscription, and the periodic reconcile blanks them for any workspace
 *   with no subscription. A trial recorded there would be erased within
 *   minutes of starting, by design, silently.
 * - `plan` is likewise reasserted from the subscription (or its absence) on
 *   every reconcile and every webhook, so a trial written there survives only
 *   until the next tick.
 *
 * Held separately, the trial is inert data that no other writer has an opinion
 * about, and the plan it lends is applied when the config is *read*. Two
 * properties fall out of that. Expiry needs no job: the stored block already
 * describes the post-trial world the whole time the trial is running. And the
 * record outlives the trial, so a second start finds it and hands out nothing.
 */
export interface CloudTrial {
  /** The plan the workspace holds until {@link endsAt}. */
  plan: PlanId
  /** ISO timestamp. */
  startedAt: string
  /** ISO timestamp. Exclusive: at this instant the trial is over. */
  endsAt: string
}

// ---------------------------------------------------------------------------
// The resolved config
// ---------------------------------------------------------------------------

/** Which writer last set plan/entitlements. Recorded so a downgrade is explicable. */
export type CloudWriter = 'config' | 'billing'

export interface CloudConfig {
  /**
   * The master switch. False — the default, and the value an unconfigured or
   * self-hosted install always has — means every entitlement reads as granted
   * and no refusal is ever raised.
   */
  enabled: boolean
  /**
   * The plan in force *now*. Null when cloud is disabled, or when enabled
   * without a plan.
   *
   * While a trial is running this is the trial's plan rather than the stored
   * one, which is what makes a trial need no special handling anywhere else:
   * entitlements, refusal copy and the plan shown on screen all read this
   * field and are all correct on both sides of the trial's end.
   */
  plan: PlanId | null
  /**
   * Explicit per-key overrides on top of the plan's defaults. Sparse: a key
   * absent here falls back to the plan's grant list.
   */
  entitlements: Partial<Record<EntitlementKey, boolean>>
  billing: CloudBilling
  /**
   * The trial this workspace was given, if it was ever given one. Present
   * after it has ended: it is the record that a trial happened, not a claim
   * that one is running. Ask {@link trialActive} for that.
   */
  trial: CloudTrial | null
  /**
   * Whether {@link plan} came from {@link trial} rather than from the stored
   * plan. Resolved once, here, because it depends on the current time: a
   * caller deriving it again with its own clock is how a countdown and a gate
   * come to disagree.
   */
  trialActive: boolean
  source: CloudWriter | null
  /** ISO timestamp of the last write, or null. */
  updatedAt: string | null
  /**
   * Optional link an upgrade prompt points at. Operator-set; absent on OSS.
   */
  upgradeUrl: string | null
}

/**
 * The config an install with no `settings.cloud` value gets. Frozen so a
 * caller cannot mutate the shared default into something that gates.
 */
export const DISABLED_CLOUD_CONFIG: CloudConfig = Object.freeze({
  enabled: false,
  plan: null,
  entitlements: Object.freeze({}) as Partial<Record<EntitlementKey, boolean>>,
  billing: Object.freeze({ ...EMPTY_BILLING }),
  trial: null,
  trialActive: false,
  source: null,
  updatedAt: null,
  upgradeUrl: null,
}) as CloudConfig
