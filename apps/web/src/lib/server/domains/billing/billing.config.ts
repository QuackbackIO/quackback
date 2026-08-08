/**
 * Billing configuration: the switch that decides whether any of this module
 * exists at runtime.
 *
 * Everything here is read from the environment, and the module is **off**
 * unless every required value is present. That is not a convenience default —
 * it is the guarantee that a self-hosted install behaves exactly as it did
 * before this module was written: no provider client, no metering, no webhook
 * route work, no admin surface, no plan.
 *
 * Read `BILLING.md` in this directory before changing anything here.
 */

import { z } from 'zod'
import { logger } from '@/lib/server/logger'
import { PLAN_IDS, type PlanId } from '../settings/cloud/cloud.types'
import type { TierLimits } from '../settings/tier-limits.types'

const log = logger.child({ component: 'billing-config' })

/**
 * The only provider implemented. Named as a value rather than assumed so a
 * stored `billing.provider` can be compared against it, and so a second
 * provider is an additive change rather than a rewrite.
 */
export const BILLING_PROVIDER = 'stripe' as const

export type BillingProvider = typeof BILLING_PROVIDER

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

/**
 * Everything the subscription can be charged for.
 *
 * `fullSeat` / `liteSeat` / `copilotSeat` are licensed quantities the product
 * pushes; `resolvedOutcome` is metered usage the product reports as events.
 * The distinction matters: a quantity is declarative (set it to the truth and
 * the provider prorates), an event is append-only (report it twice and the
 * customer is charged twice), so they need different idempotency stories.
 */
export const BILLING_METERS = ['fullSeat', 'liteSeat', 'copilotSeat', 'resolvedOutcome'] as const

export type BillingMeter = (typeof BILLING_METERS)[number]

/** The quantity meters, i.e. the ones pushed as subscription-item quantities. */
export const SEAT_METERS = ['fullSeat', 'liteSeat', 'copilotSeat'] as const satisfies readonly BillingMeter[]

export type SeatMeter = (typeof SEAT_METERS)[number]

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * Per-plan price identifiers and the numeric limits that plan implies.
 *
 * This is the **control plane's** half of the boundary: which plans may be
 * sold, what they cost, and what they cap. It is fleet-wide (identical for
 * every workspace) and therefore an environment value, exactly like the
 * fleet-wide AI and email credentials described in SAAS-HOSTING-STACK.md §8.
 * What is per-workspace — which plan this workspace bought, how many seats it
 * is using, what it owes — is the product's half and lives in the database.
 *
 * `outcome` is optional: a plan may include AI resolutions in its seat price
 * rather than charging per resolution.
 */
const planPricesSchema = z
  .object({
    /** Licensed price for a full seat. Required — a plan is sold per seat. */
    seat: z.string().min(1),
    /** Licensed price for a reduced-rate seat. Optional: a plan may not offer one. */
    liteSeat: z.string().min(1).optional(),
    /** Licensed price for the Copilot add-on, charged per entitled seat. */
    copilotSeat: z.string().min(1).optional(),
    /** Metered price for a resolved AI outcome. */
    outcome: z.string().min(1).optional(),
    /**
     * Provider meter identifier that `outcome` bills from. Required when
     * `outcome` is set: usage is reported against the meter, not the price.
     */
    outcomeMeter: z.string().min(1).optional(),
    /**
     * Numeric limits this plan implies, written into `settings.tier_limits`
     * when the subscription is applied. Sparse — anything omitted keeps the
     * unlimited default.
     */
    limits: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((p) => p.outcome === undefined || p.outcomeMeter !== undefined, {
    message: 'outcomeMeter is required whenever outcome is set',
  })

/**
 * Keys are validated against `PLAN_IDS` after parsing rather than by
 * `z.record(z.enum(PLAN_IDS), …)`, which is *exhaustive* — it would demand
 * every plan in the catalogue be priced, so a deployment selling only Pro and
 * Business could not configure at all. Selling a subset of the modelled plans
 * is the normal case, not an error.
 */
const catalogueSchema = z.record(z.string(), planPricesSchema)

export type PlanPrices = z.infer<typeof planPricesSchema> & {
  limits?: Partial<TierLimits>
}

export type BillingCatalogue = Partial<Record<PlanId, PlanPrices>>

export interface BillingConfig {
  provider: BillingProvider
  apiKey: string
  webhookSecret: string
  catalogue: BillingCatalogue
  /** True when the API key is a live-mode key. Test mode otherwise. */
  livemode: boolean
  /** Where the provider returns the browser after checkout. */
  returnUrl: string
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolved once per process. `null` means "not configured", which is a
 * first-class state rather than an error: every entry point checks it and
 * does nothing.
 *
 * Memoised on the resolved value, and the memo is a module-scope cache — the
 * one kind SAAS-HOSTING-STACK.md §4.4 warns about. It is safe here only
 * because this is fleet-wide configuration, identical for every tenant, in
 * the same class as `config.openaiApiKey`. Anything per-workspace must not
 * join it.
 */
let resolved: { value: BillingConfig | null } | null = null

export function getBillingConfig(): BillingConfig | null {
  if (resolved) return resolved.value
  resolved = { value: resolveBillingConfig() }
  return resolved.value
}

/** Test seam. Never called in production code. */
export function resetBillingConfigCache(): void {
  resolved = null
}

export function isBillingConfigured(): boolean {
  return getBillingConfig() !== null
}

function resolveBillingConfig(): BillingConfig | null {
  const apiKey = process.env.BILLING_API_KEY || undefined
  const webhookSecret = process.env.BILLING_WEBHOOK_SECRET || undefined
  const rawCatalogue = process.env.BILLING_PRICES || undefined

  // Nothing configured at all: the overwhelmingly common case (every
  // self-hosted install). Silent — this is not a misconfiguration.
  if (!apiKey && !webhookSecret && !rawCatalogue) return null

  // Partially configured: loud, because it is always a mistake, and because
  // failing silently here would look identical to "billing is off" while an
  // operator believed they had switched it on.
  if (!apiKey || !webhookSecret || !rawCatalogue) {
    log.error(
      {
        hasApiKey: Boolean(apiKey),
        hasWebhookSecret: Boolean(webhookSecret),
        hasCatalogue: Boolean(rawCatalogue),
      },
      'billing is partially configured; all of BILLING_API_KEY, BILLING_WEBHOOK_SECRET and BILLING_PRICES are required. Billing stays off.'
    )
    return null
  }

  const livemode = !isTestModeKey(apiKey)
  if (livemode && process.env.BILLING_ALLOW_LIVE !== 'true') {
    // The classic incident this prevents: a staging or review environment
    // inheriting the production key and charging real customers from a
    // synthetic seat count. Requiring a second, explicit variable makes a
    // live key an intentional act rather than a copy-paste.
    log.error(
      'BILLING_API_KEY is a live-mode key but BILLING_ALLOW_LIVE is not "true". Billing stays off.'
    )
    return null
  }

  let catalogue: BillingCatalogue
  try {
    const parsed = catalogueSchema.parse(JSON.parse(rawCatalogue))
    const unknown = Object.keys(parsed).filter((id) => !(PLAN_IDS as readonly string[]).includes(id))
    if (unknown.length > 0) {
      // Refuse rather than drop. A price id filed under a plan the product
      // cannot model would resolve to no plan on the next subscription read,
      // silently downgrading a paying workspace to Free.
      log.error({ unknown }, 'BILLING_PRICES names plans the product does not model. Billing stays off.')
      return null
    }
    catalogue = parsed as BillingCatalogue
  } catch (error) {
    log.error({ err: error }, 'BILLING_PRICES is not a valid plan catalogue. Billing stays off.')
    return null
  }

  if (Object.keys(catalogue).length === 0) {
    log.error('BILLING_PRICES declares no plans. Billing stays off.')
    return null
  }

  const returnUrl = process.env.BILLING_RETURN_URL || undefined

  log.info(
    { livemode, plans: Object.keys(catalogue).sort() },
    'billing configured'
  )

  return {
    provider: BILLING_PROVIDER,
    apiKey,
    webhookSecret,
    catalogue,
    livemode,
    returnUrl: returnUrl ?? '',
  }
}

/**
 * Test-mode key detection.
 *
 * Both the plain secret key and the restricted-key form carry the mode in
 * their prefix, and a key with neither recognised prefix is treated as LIVE —
 * the safe direction, because an unrecognised key that is actually live and
 * assumed to be test would be exactly the accident the guard exists to stop.
 */
function isTestModeKey(key: string): boolean {
  return key.startsWith('sk_test_') || key.startsWith('rk_test_')
}

/** The plan a price id belongs to, or null. Used to resolve a subscription. */
export function planForPrice(catalogue: BillingCatalogue, priceId: string): PlanId | null {
  for (const planId of PLAN_IDS) {
    const prices = catalogue[planId]
    if (!prices) continue
    if (
      prices.seat === priceId ||
      prices.liteSeat === priceId ||
      prices.copilotSeat === priceId ||
      prices.outcome === priceId
    ) {
      return planId
    }
  }
  return null
}

/** Which meter a price id represents within `plan`, or null. */
export function meterForPrice(prices: PlanPrices, priceId: string): BillingMeter | null {
  if (prices.seat === priceId) return 'fullSeat'
  if (prices.liteSeat === priceId) return 'liteSeat'
  if (prices.copilotSeat === priceId) return 'copilotSeat'
  if (prices.outcome === priceId) return 'resolvedOutcome'
  return null
}
