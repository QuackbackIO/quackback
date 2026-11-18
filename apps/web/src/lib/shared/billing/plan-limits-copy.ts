/**
 * The words for plan limits, shared by the admin banner, the sidebar line,
 * the Plan limits page, the billing usage card and the downgrade dialog, so
 * every surface says the same thing about the same row. Pure: the date comes
 * in already formatted.
 */
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import {
  PLAN_FEATURES,
  type PlanFeatureKey,
} from '@/lib/server/domains/plan-limits/plan-limits.features'
import { PLAN_CATALOGUE, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PLAN_NUMERIC_CAPS, type PlanCapKey } from './plan-downgrade'

/** A grace date is ahead (future tense); an enforced one has passed (present tense). */
export type PlanLimitsTense = 'grace' | 'enforced'

/** The plan limits states that show anything at all. */
export function isPlanLimitsOver(
  limits: Pick<PlanLimitsPage, 'enabled' | 'phase'> | null | undefined
): limits is Pick<PlanLimitsPage, 'enabled' | 'phase'> & { phase: PlanLimitsTense } {
  return Boolean(limits?.enabled) && (limits?.phase === 'grace' || limits?.phase === 'enforced')
}

/** Short row names, as on the billing usage card. */
export const PLAN_CAP_LABELS: Record<PlanCapKey | 'aiTokensPerMonth' | 'emailsPerMonth', string> = {
  maxBoards: 'Boards',
  maxPosts: 'Posts',
  maxTeamSeats: 'Team seats',
  maxStatusComponents: 'Status components',
  maxCustomRoles: 'Custom roles',
  maxSendingDomains: 'Sending domains',
  maxInboundEmailAddresses: 'Inbound email addresses',
  maxHelpCenterLocales: 'Help center languages',
  maxStatusSubscribers: 'Status subscribers',
  aiTokensPerMonth: 'AI usage',
  emailsPerMonth: 'Emails',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What happens to the excess of a cap: on `date` while in grace, now once enforced. */
export function capConsequence(
  key: PlanCapKey,
  excess: number,
  tense: PlanLimitsTense,
  date: string,
  plan = 'current'
): string {
  const grace = tense === 'grace'
  const on = (line: string) => `On ${date}, ${line}`
  switch (key) {
    case 'maxBoards':
      return grace
        ? on(
            `${plural(excess, 'board becomes', 'boards become')} read-only. Their posts stay visible.`
          )
        : `${plural(excess, 'board is', 'boards are')} read-only. Their posts stay visible.`
    case 'maxTeamSeats':
      return grace
        ? on(
            `${plural(excess, 'teammate loses', 'teammates lose')} admin access until a seat frees up.`
          )
        : `${plural(excess, 'teammate has', 'teammates have')} no admin access until a seat frees up.`
    case 'maxStatusComponents':
      return grace
        ? on(`${plural(excess, 'component is', 'components are')} hidden from your status page.`)
        : `${plural(excess, 'component is', 'components are')} hidden from your status page.`
    case 'maxCustomRoles':
      return grace
        ? on('custom roles are locked. People on them keep their access.')
        : `Custom roles are locked on the ${plan} plan. People on them keep their access.`
    case 'maxSendingDomains':
      return grace
        ? on(
            `${plural(excess, 'sending domain pauses', 'sending domains pause')}. Email goes from your default address.`
          )
        : `Paused on the ${plan} plan. Email goes from your default address.`
    case 'maxHelpCenterLocales':
      return grace
        ? on(`${plural(excess, 'language is', 'languages are')} locked. Published pages stay live.`)
        : `${plural(excess, 'language is', 'languages are')} locked on the ${plan} plan. Published pages stay live.`
    case 'maxPosts':
      return 'New posts stop at the cap. Existing posts stay.'
    case 'maxInboundEmailAddresses':
      return 'No new addresses. Existing ones keep working.'
    case 'maxStatusSubscribers':
      return 'New sign-ups stop at the cap. Existing subscribers keep getting updates.'
  }
}

/** The quiet note under an information row: nothing to fix, only new ones stop. */
export function infoRowNote(row: { key: string; message: string; cap: number }): string {
  if (row.key === 'aiTokensPerMonth' || row.key === 'emailsPerMonth') return `${row.message}.`
  // The billing usage card says the same.
  if (row.key === 'maxPosts') return `New posts stop at ${row.cap}. Existing posts stay.`
  if (row.key === 'maxStatusSubscribers') {
    return `New sign-ups stop at ${row.cap}. Existing subscribers keep getting updates.`
  }
  return capConsequence(row.key as PlanCapKey, 0, 'enforced', '')
}

/**
 * The line under a paid feature's name: what pauses on the date, or that it is
 * paused on the plan. "Nothing is deleted" is said once for the page, not here.
 */
export function featureConsequence(
  key: PlanFeatureKey,
  count: number,
  tense: PlanLimitsTense,
  plan = 'current'
): string {
  if (tense === 'enforced') {
    const paused = `Paused on the ${plan} plan.`
    if (key === 'sso') return `${paused} Your team signs in with email links.`
    if (key === 'customDomain') return `${paused} Links go to your workspace address.`
    if (key === 'aiAssistant') return `${paused} New conversations go to your team.`
    return paused
  }
  switch (key) {
    case 'webhooks':
      return `Deliveries to ${plural(count, 'endpoint', 'endpoints')} pause.`
    case 'workflows':
      return `${plural(count, 'live workflow pauses', 'live workflows pause')}.`
    case 'integrations':
      return 'Sync and notifications pause.'
    case 'customDomain':
      return 'Pauses. Links go to your workspace address.'
    case 'customCss':
      return 'Pauses on your portal.'
    case 'sso':
      return 'Pauses. Your team signs in with email links.'
    case 'aiAssistant':
      return 'Pauses. New conversations go to your team.'
    case 'aiArticleTranslation':
      return 'New translations pause. Published ones stay.'
    default:
      return 'Pauses.'
  }
}

/** The excess of each over cap, as a short clause for the enforced banner. */
function pausedClause(issue: { key: string; used: number; cap: number }): string | null {
  const n = issue.used - issue.cap
  switch (issue.key) {
    case 'maxBoards':
      return `${plural(n, 'board is', 'boards are')} read-only`
    case 'maxTeamSeats':
      return `${plural(n, 'teammate has', 'teammates have')} no admin access`
    case 'maxStatusComponents':
      return `${plural(n, 'status component is', 'status components are')} hidden`
    case 'maxCustomRoles':
      return 'custom roles are locked'
    case 'maxSendingDomains':
      return `${plural(n, 'sending domain is', 'sending domains are')} paused`
    case 'maxHelpCenterLocales':
      return `${plural(n, 'help center language is', 'help center languages are')} locked`
    default:
      return null
  }
}

/** Feature names that take a plural verb. */
const PLURAL_FEATURES = new Set<PlanFeatureKey>(['webhooks', 'workflows', 'integrations'])

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? ''
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`
  return `${clauses[0]}, ${clauses[1]} and more`
}

/** "4 boards are read-only and webhooks are paused", from the caps first, then features. */
export function pausedSummary(limits: Pick<PlanLimitsPage, 'issues' | 'featureIssues'>): string {
  const clauses = limits.issues.map(pausedClause).filter((c): c is string => c !== null)
  for (const feature of limits.featureIssues) {
    const name = `${feature.label.charAt(0).toLowerCase()}${feature.label.slice(1)}`
    clauses.push(`${name} ${PLURAL_FEATURES.has(feature.key) ? 'are' : 'is'} paused`)
  }
  const text = joinClauses(clauses)
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : ''
}

export interface PlanLimitsBannerCopy {
  tone: 'grace' | 'enforced'
  title: string
  body: string
  action: string
}

/**
 * The admin banner's words, or null when it shows nothing: the flag is off,
 * nothing is over, or only paused features remain once enforced (each of
 * those pages carries its own line instead).
 */
export function planLimitsBannerCopy(
  limits: Pick<
    PlanLimitsPage,
    | 'enabled'
    | 'phase'
    | 'issues'
    | 'featureIssues'
    | 'planName'
    | 'fromPlanName'
    | 'canManageBilling'
  >,
  date: string
): PlanLimitsBannerCopy | null {
  if (!isPlanLimitsOver(limits)) return null
  const plan = limits.planName ?? 'current'
  const title = `Your workspace is over the ${plan} plan's limits.`
  const ask = 'Ask someone who manages billing to upgrade.'
  if (limits.phase === 'enforced') {
    if (limits.issues.length === 0) return null
    return {
      tone: 'enforced',
      title,
      body: `${pausedSummary(limits)} ${
        limits.canManageBilling ? 'They come back when you upgrade.' : ask
      }`,
      action: 'Review issues',
    }
  }
  const n = limits.issues.length
  const fix =
    n > 0 ? `Fix ${plural(n, 'issue', 'issues')} by ${date}` : `Some features pause on ${date}`
  return {
    tone: 'grace',
    title,
    body: limits.canManageBilling
      ? n > 0
        ? `${fix}, or upgrade to keep everything.`
        : `${fix}. Upgrade to keep everything.`
      : `${fix}. ${ask}`,
    action: 'Review issues',
  }
}

const lowerFirst = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label

function capLine(key: PlanCapKey, cap: number | null): string {
  const noun = PLAN_CAP_LABELS[key].toLowerCase()
  return cap === null ? `Unlimited ${noun}` : `Up to ${cap} ${noun}`
}

/**
 * What `target` keeps of this page, at most five short lines: its caps for
 * every row over (boards and posts read as one line when both are
 * unlimited), then the paused features it includes.
 */
export function keepEverythingLines(
  limits: Pick<PlanLimitsPage, 'issues' | 'infoRows' | 'featureIssues' | 'fromPlan'>,
  target: PlanId
): string[] {
  const caps = PLAN_NUMERIC_CAPS[target]
  const keys = new Set<string>([
    ...limits.issues.map((issue) => issue.key),
    ...limits.infoRows.map((row) => row.key),
  ])
  const lines: string[] = []
  if (
    keys.has('maxBoards') &&
    keys.has('maxPosts') &&
    caps.maxBoards === null &&
    caps.maxPosts === null
  ) {
    lines.push('Unlimited boards and posts')
    keys.delete('maxBoards')
    keys.delete('maxPosts')
  }
  for (const key of Object.keys(caps) as PlanCapKey[]) {
    // A cap of none says nothing the plan keeps.
    if (keys.has(key) && caps[key] !== 0) lines.push(capLine(key, caps[key]))
  }
  // A feature the plan grants, or any the plan before had when the target is
  // that plan (tier features carry no grant to check).
  const grants = new Set<string>(PLAN_CATALOGUE[target].grants)
  const features = limits.featureIssues
    .filter((feature) => {
      const entitlement = PLAN_FEATURES[feature.key].entitlement
      return entitlement ? grants.has(entitlement) : limits.fromPlan === target
    })
    .map((feature, index) => (index === 0 ? feature.label : lowerFirst(feature.label)))
  if (features.length > 0) lines.push(joinAll(features))
  return lines.slice(0, 5)
}

function joinAll(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
