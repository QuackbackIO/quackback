import { TierLimitError } from './tier-limit-error'

export interface EntitlementErrorPayload {
  /** Catalogue key, e.g. 'customDomain'. */
  entitlement: string
  /** Human-readable feature name used in the message, e.g. 'Custom domains'. */
  friendly: string
  /** Whether {@link friendly} takes a plural verb ("are" rather than "is"). */
  friendlyIsPlural: boolean
  /** Indefinite article for {@link requiredPlanName} ("a Pro", "an Enterprise"). */
  requiredPlanArticle: 'a' | 'an' | null
  /** Plan the workspace is on right now, or null when it has none. */
  currentPlan: string | null
  /** Display name for {@link currentPlan}, or null. */
  currentPlanName: string | null
  /**
   * Cheapest plan that grants this entitlement, or null when no plan in the
   * catalogue does (an entitlement granted only by a bespoke arrangement).
   */
  requiredPlan: string | null
  /** Display name for {@link requiredPlan}, or null. */
  requiredPlanName: string | null
  /** Optional operator-configured link the upgrade prompt points at. */
  upgradeUrl?: string
}

/**
 * Thrown when a feature is gated on a plan entitlement the workspace does not
 * hold.
 *
 * Deliberately a subclass of {@link TierLimitError}: every REST route,
 * server-fn boundary and AI-degradation path in the codebase already
 * discriminates on `instanceof TierLimitError` and maps it to HTTP 402 with
 * `toResponseBody()`, so an entitlement refusal inherits that plumbing whole
 * rather than needing a second pass over every catch site.
 *
 * What it adds over the numeric refusal is the reason upsell is possible at
 * all: the payload names the plan that would grant the feature, so the
 * message can say "that is a Pro feature" instead of "not allowed". A
 * refusal that cannot name a plan is a bug in this class's construction, not
 * an acceptable degraded case — see `describeEntitlementRefusal`.
 *
 * Never thrown on an unconfigured install: `requireEntitlement` short-circuits
 * when `settings.cloud` is absent or `enabled: false`.
 */
export class EntitlementRequiredError extends TierLimitError {
  readonly entitlement: string
  readonly currentPlan: string | null
  readonly currentPlanName: string | null
  readonly requiredPlan: string | null
  readonly requiredPlanName: string | null
  readonly upgradeUrl?: string

  constructor(payload: EntitlementErrorPayload) {
    super({
      limit: `entitlements.${payload.entitlement}`,
      message: buildMessage(payload),
    })
    this.entitlement = payload.entitlement
    this.currentPlan = payload.currentPlan
    this.currentPlanName = payload.currentPlanName
    this.requiredPlan = payload.requiredPlan
    this.requiredPlanName = payload.requiredPlanName
    this.upgradeUrl = payload.upgradeUrl
  }

  override toResponseBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      // Distinct discriminator from the numeric refusal so a client can tell
      // "buy a bigger plan" apart from "you are over a count".
      error: 'entitlement_required',
      limit: this.limit,
      entitlement: this.entitlement,
      message: this.message,
      currentPlan: this.currentPlan,
      requiredPlan: this.requiredPlan,
    }
    if (this.currentPlanName) body.currentPlanName = this.currentPlanName
    if (this.requiredPlanName) body.requiredPlanName = this.requiredPlanName
    if (this.upgradeUrl) body.upgradeUrl = this.upgradeUrl
    return body
  }
}

/**
 * The refusal copy. Names the plan whenever the catalogue knows one — that is
 * the entire point of this error existing alongside the numeric one.
 */
function buildMessage(payload: EntitlementErrorPayload): string {
  // Both the verb and the article are supplied by the catalogue rather than
  // inferred here. Inferring either produced real defects ("Custom domains is
  // a Enterprise feature") that substring assertions could not see.
  const verb = payload.friendlyIsPlural ? 'are' : 'is'
  const on = payload.currentPlanName ? ` Your workspace is on ${payload.currentPlanName}.` : ''
  if (!payload.requiredPlanName) {
    return `${payload.friendly} ${verb} not included in your plan.${on} Contact us to enable it.`
  }
  const article = payload.requiredPlanArticle ?? 'a'
  return `${payload.friendly} ${verb} ${article} ${payload.requiredPlanName} feature.${on} Upgrade to ${payload.requiredPlanName} to enable it.`
}
