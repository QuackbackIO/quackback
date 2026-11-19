/**
 * What the Plan limits page gets: the state, each row with its label and
 * link, and the candidates for each chooser the viewer may use.
 */
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PLAN_FEATURE_LINKS, type PlanFeatureKey } from './plan-limits.features'
import type {
  BoardChoice,
  MemberChoice,
  SendingDomainChoice,
  StatusComponentChoice,
} from './plan-limits.loaders'
import { guaranteedSeatHolders } from './plan-limits.order'
import type { PlanLimitFixedIssue, PlanLimitIssueKey, PlanLimitsView } from './plan-limits.rules'

export type PlanLimitsChooser = 'board' | 'seats' | 'statusComponents' | 'sendingDomains'

/** The cap each chooser picks for, and who may use it besides a billing manager. */
export const CHOOSERS: Record<
  PlanLimitsChooser,
  { cap: PlanLimitIssueKey; permission: PermissionKey }
> = {
  board: { cap: 'maxBoards', permission: PERMISSIONS.SETTINGS_MANAGE },
  seats: { cap: 'maxTeamSeats', permission: PERMISSIONS.MEMBER_MANAGE },
  statusComponents: { cap: 'maxStatusComponents', permission: PERMISSIONS.STATUS_PAGE_MANAGE },
  sendingDomains: { cap: 'maxSendingDomains', permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE },
}

export function canUseChooser(
  chooser: PlanLimitsChooser,
  permissions: readonly PermissionKey[]
): boolean {
  return (
    permissions.includes(PERMISSIONS.BILLING_MANAGE) ||
    permissions.includes(CHOOSERS[chooser].permission)
  )
}

export interface PlanLimitsPageCandidates {
  boards?: BoardChoice[]
  members?: MemberChoice[]
  statusComponents?: StatusComponentChoice[]
  sendingDomains?: SendingDomainChoice[]
}

export interface PlanLimitsFeatureRow {
  key: PlanFeatureKey
  count: number
  label: string
  href: string | null
}

export type PlanLimitsPage = Omit<
  PlanLimitsView,
  'features' | 'fromFeatures' | 'featureIssues' | 'fixedIssues'
> & {
  /** Caps over at first detection that fit now. */
  fixedIssues: PlanLimitFixedIssue[]
  /** Members who always keep a seat (the owner and a billing manager); empty without the member list. */
  lockedSeatHolderIds: string[]
  planName: string | null
  fromPlanName: string | null
  featureIssues: PlanLimitsFeatureRow[]
  /** Whether the viewer can choose for each cap that is over. */
  choosers: Record<PlanLimitsChooser, boolean>
  /** Candidates, only for choosers the viewer may use and caps that are over. */
  candidates: PlanLimitsPageCandidates
  canManageBilling: boolean
}

const CANDIDATE_FOR: Record<PlanLimitsChooser, keyof PlanLimitsPageCandidates> = {
  board: 'boards',
  seats: 'members',
  statusComponents: 'statusComponents',
  sendingDomains: 'sendingDomains',
}

/** The line added to the used-up email row once broadcasts were held back. */
export function skippedBroadcastsNote(count: number): string {
  return count === 1 ? '1 update was not sent' : `${count} updates were not sent`
}

export function planLimitsPage(
  view: PlanLimitsView,
  candidates: PlanLimitsPageCandidates,
  permissions: readonly PermissionKey[],
  skippedBroadcasts = 0
): PlanLimitsPage {
  const over = new Set(view.issues.map((issue) => issue.key))
  const choosers = {} as Record<PlanLimitsChooser, boolean>
  const shown: PlanLimitsPageCandidates = {}
  for (const chooser of Object.keys(CHOOSERS) as PlanLimitsChooser[]) {
    const allowed = over.has(CHOOSERS[chooser].cap) && canUseChooser(chooser, permissions)
    choosers[chooser] = allowed
    const part = CANDIDATE_FOR[chooser]
    if (allowed && candidates[part]) Object.assign(shown, { [part]: candidates[part] })
  }
  return {
    enabled: view.enabled,
    phase: view.phase,
    plan: view.plan,
    since: view.since,
    graceEndsAt: view.graceEndsAt,
    deadlineDay: view.deadlineDay,
    fromPlan: view.fromPlan,
    issues: view.issues,
    fixedIssues: view.fixedIssues ?? [],
    infoRows: view.infoRows.map((row) =>
      row.key === 'emailsPerMonth' && skippedBroadcasts > 0
        ? { ...row, message: `${row.message}. ${skippedBroadcastsNote(skippedBroadcasts)}` }
        : row
    ),
    openBoardIds: view.openBoardIds,
    keptBoardId: view.keptBoardId,
    seatHolderIds: view.seatHolderIds,
    visibleStatusComponentIds: view.visibleStatusComponentIds,
    sendingDomainIds: view.sendingDomainIds,
    planName: view.plan ? PLAN_CATALOGUE[view.plan].name : null,
    fromPlanName: view.fromPlan ? PLAN_CATALOGUE[view.fromPlan].name : null,
    featureIssues: view.featureIssues.map((issue) => ({
      ...issue,
      label: PLAN_FEATURE_LINKS[issue.key]?.label ?? issue.key,
      href: PLAN_FEATURE_LINKS[issue.key]?.href ?? null,
    })),
    choosers,
    candidates: shown,
    lockedSeatHolderIds: shown.members ? guaranteedSeatHolders(shown.members) : [],
    canManageBilling: permissions.includes(PERMISSIONS.BILLING_MANAGE),
  }
}
