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
  date: string
): string {
  const on = (line: string) => (tense === 'grace' ? `On ${date}, ${line}` : line)
  switch (key) {
    case 'maxBoards':
      return tense === 'grace'
        ? on(
            `${plural(excess, 'board becomes', 'boards become')} read-only. Their posts stay visible to everyone.`
          )
        : `${plural(excess, 'board is', 'boards are')} read-only. Their posts stay visible to everyone.`
    case 'maxTeamSeats':
      return tense === 'grace'
        ? on(
            `${plural(excess, 'teammate loses', 'teammates lose')} admin access until a seat frees. Their conversations and history stay.`
          )
        : `${plural(excess, 'teammate has', 'teammates have')} no admin access until a seat frees. Their conversations and history stay.`
    case 'maxStatusComponents':
      return tense === 'grace'
        ? on(
            `${plural(excess, 'component is', 'components are')} hidden from your status page. ${excess === 1 ? 'It stays' : 'They stay'} in your admin.`
          )
        : `${plural(excess, 'component is', 'components are')} hidden from your status page. ${excess === 1 ? 'It stays' : 'They stay'} in your admin.`
    case 'maxCustomRoles':
      return tense === 'grace'
        ? on('custom roles lock. People on them keep their access.')
        : 'Custom roles are locked. People on them keep their access.'
    case 'maxSendingDomains':
      return tense === 'grace'
        ? on(
            `mail from ${plural(excess, 'domain', 'domains')} sends from your default address. The ${excess === 1 ? 'domain is' : 'domains are'} kept.`
          )
        : `Mail from ${plural(excess, 'domain', 'domains')} sends from your default address. The ${excess === 1 ? 'domain is' : 'domains are'} kept.`
    case 'maxHelpCenterLocales':
      return tense === 'grace'
        ? on(
            `${plural(excess, 'language locks', 'languages lock')} for editing. Published pages keep serving.`
          )
        : `${plural(excess, 'language is', 'languages are')} locked for editing. Published pages keep serving.`
    case 'maxPosts':
      return 'New posts are paused. Existing posts stay.'
    case 'maxInboundEmailAddresses':
      return 'No new addresses. Existing ones keep working.'
    case 'maxStatusSubscribers':
      return 'New sign-ups are paused. Existing subscribers keep getting updates.'
  }
}

/** The quiet note under an information row: nothing to fix, only new ones stop. */
export function infoRowNote(row: { key: string; message: string }): string {
  if (row.key === 'aiTokensPerMonth' || row.key === 'emailsPerMonth') return `${row.message}.`
  return capConsequence(row.key as PlanCapKey, 0, 'enforced', '')
}

/** One line per paid feature that pauses, in the present tense, after its name. */
export function featureConsequence(
  key: PlanFeatureKey,
  count: number,
  tense: PlanLimitsTense
): string {
  const now = tense === 'enforced'
  switch (key) {
    case 'webhooks':
      return now
        ? `Deliveries to ${plural(count, 'endpoint are', 'endpoints are')} paused. Endpoints and secrets are kept.`
        : `Deliveries to ${plural(count, 'endpoint', 'endpoints')} pause. Endpoints and secrets are kept.`
    case 'workflows':
      return now
        ? `${plural(count, 'live workflow is', 'live workflows are')} paused. They are kept.`
        : `${plural(count, 'live workflow pauses', 'live workflows pause')}. They are kept.`
    case 'integrations':
      return now
        ? 'Sync and notifications are paused. Connections are kept.'
        : 'Sync and notifications pause. Connections are kept.'
    case 'customDomain':
      return 'Redirects to your workspace address. Links keep working.'
    case 'customCss':
      return now ? 'Not shown. It is kept.' : 'Stops showing. It is kept.'
    case 'sso':
      return now
        ? 'Off. Your team signs in with email links. Settings are kept.'
        : 'Turns off. Your team will sign in with email links. Settings are kept.'
    case 'aiAssistant':
      return now
        ? 'Not answering customers. New conversations go to your team.'
        : 'Stops answering customers. New conversations go to your team.'
    case 'aiArticleTranslation':
      return now
        ? 'New translations are paused. Published ones stay.'
        : 'New translations stop. Published ones stay.'
    default:
      return now ? 'Paused. It is kept.' : 'Pauses. It is kept.'
  }
}

/** The excess of each over cap, as a short clause for the enforced banner. */
function pausedClause(issue: { key: string; used: number; cap: number }): string | null {
  const n = issue.used - issue.cap
  switch (issue.key) {
    case 'maxBoards':
      return `${plural(n, 'board is', 'boards are')} read-only`
    case 'maxTeamSeats':
      return `${plural(n, 'teammate is', 'teammates are')} paused`
    case 'maxStatusComponents':
      return `${plural(n, 'status component is', 'status components are')} hidden`
    case 'maxCustomRoles':
      return 'custom roles are locked'
    case 'maxSendingDomains':
      return `${plural(n, 'sending domain is', 'sending domains are')} off`
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
  if (limits.phase === 'enforced') {
    if (limits.issues.length === 0) return null
    return {
      tone: 'enforced',
      title: `Paused on the ${plan} plan.`,
      body: limits.canManageBilling
        ? `${pausedSummary(limits)} Upgrade to bring them back.`
        : pausedSummary(limits),
      action: limits.canManageBilling ? 'Review' : "See what's affected",
    }
  }
  const title = `Over the ${plan} plan limits.`
  if (!limits.canManageBilling) {
    return {
      tone: 'grace',
      title,
      body: `An owner needs to choose a plan by ${date}.`,
      action: "See what's affected",
    }
  }
  const n = limits.issues.length
  const keep =
    limits.fromPlanName && limits.fromPlanName !== limits.planName
      ? `, or keep everything on ${limits.fromPlanName}`
      : ''
  return {
    tone: 'grace',
    title,
    body:
      n > 0
        ? `Fix ${plural(n, 'thing', 'things')} by ${date}${keep}.`
        : `Some features pause on ${date}${keep}.`,
    action: n > 0 ? `Review ${plural(n, 'issue', 'issues')}` : 'Review',
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
