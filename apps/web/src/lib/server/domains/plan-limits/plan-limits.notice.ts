/**
 * What the admin banner gets for a teammate who cannot view members, and so
 * cannot open the Plan limits page: whether the workspace is over, by when,
 * and how many issues, with nothing about the team. Built by allowlist, so a
 * field added to the page never reaches it unseen.
 */
import type { PermissionKey } from '@/lib/shared/permissions'
import { planLimitsPage, type PlanLimitsPage } from './plan-limits.page'
import type { PlanLimitIssueKey, PlanLimitsView } from './plan-limits.rules'

/** Caps whose counts describe the team, so this viewer gets only that they are over. */
const WITHHELD: ReadonlySet<PlanLimitIssueKey> = new Set(['maxTeamSeats'])

export type PlanLimitsNotice = Pick<
  PlanLimitsPage,
  | 'enabled'
  | 'phase'
  | 'graceEndsAt'
  | 'deadlineDay'
  | 'planName'
  | 'fromPlanName'
  | 'canManageBilling'
  | 'featureIssues'
> & {
  /** Marks the narrowed read: the Plan limits page is not open to this viewer. */
  canViewPage: false
  /** Caps over, with their counts; never one that describes the team. */
  issues: { key: PlanLimitIssueKey; used: number; cap: number }[]
  /** Caps over whose counts are withheld from this viewer. */
  withheldIssues: PlanLimitIssueKey[]
}

export function planLimitsNotice(
  view: PlanLimitsView,
  permissions: readonly PermissionKey[]
): PlanLimitsNotice {
  const page = planLimitsPage(view, {}, permissions)
  return {
    canViewPage: false,
    enabled: page.enabled,
    phase: page.phase,
    graceEndsAt: page.graceEndsAt,
    deadlineDay: page.deadlineDay,
    planName: page.planName,
    fromPlanName: page.fromPlanName,
    canManageBilling: page.canManageBilling,
    featureIssues: page.featureIssues,
    issues: page.issues
      .filter((issue) => !WITHHELD.has(issue.key))
      .map(({ key, used, cap }) => ({ key, used, cap })),
    withheldIssues: page.issues.filter((issue) => WITHHELD.has(issue.key)).map(({ key }) => key),
  }
}
