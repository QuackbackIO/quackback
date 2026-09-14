import {
  normalizeOnboardingOutcome,
  type OnboardingOutcome,
  type OutcomeTaskResolutions,
  type UseCaseType,
} from '@/lib/shared/db-types'
import type { ProductId } from '@/lib/shared/types/settings'

export interface LaunchPermissions {
  settingsManage: boolean
  boardManage: boolean
  memberManage: boolean
  brandingManage: boolean
  integrationManage: boolean
  helpCenterManage: boolean
}

export interface LaunchStatus {
  hasBoards: boolean
  hasPublicBoard?: boolean
  publicBoardId?: string | null
  publicBoardSlug?: string | null
  publicBoardPath?: string | null
  publicBoardLinkCopiedAt?: string | null
  hasInternalBoard?: boolean
  boardCount?: number
  maxBoards?: number | null
  memberCount: number
  hasBranding: boolean
  hasWidgetInstalled?: boolean
  widgetOriginHost?: string | null
  widgetLastDetectedAt?: string | null
  widgetSdkVersion?: string | null
  currentWidgetSdkVersion?: string
  widgetSdkNeedsUpdate?: boolean
  hasWidgetEnabled?: boolean
  hasMessengerEnabled?: boolean
  hasHelpArticle?: boolean
  hasPublishedChangelog?: boolean
  hasStatusComponent?: boolean
  hasIntegration?: boolean
  hasFirstWin?: boolean
  firstWinAt?: string | null
  useCase?: UseCaseType | null
  taskResolutions?: OutcomeTaskResolutions
  permissions?: LaunchPermissions
  features?: {
    supportInbox: boolean
    helpCenter: boolean
    statusPage: boolean
    integrations: boolean
    changelog?: boolean
  }
}

export type LaunchTaskHref =
  | '/admin/settings/boards'
  | '/admin/settings/members'
  | '/admin/settings/portal'
  | '/admin/settings/widget/install'
  | '/admin/settings/integrations'
  | '/admin/help-center'
  | '/admin/feedback'
  | '/admin/inbox'
  | '/admin/changelog'
  | '/admin/status'
  | '/admin'

export type LaunchTaskAvailability = 'available' | 'blocked' | 'complete'
export type LaunchTaskClassification = 'prerequisite' | 'polish' | 'first_win'

export interface LaunchTaskBlocked {
  kind: 'module-off' | 'plan-limit' | 'permission'
  productId?: ProductId
}

export interface LaunchTask {
  id: string
  title: string
  description: string
  availability: LaunchTaskAvailability
  classification: LaunchTaskClassification
  isCompleted: boolean
  isSkipped: boolean
  blocked?: LaunchTaskBlocked
  blockedReason?: string
  href?: LaunchTaskHref
  actionLabel?: string
  completedLabel: string
}

interface LaunchTaskInput extends Omit<
  LaunchTask,
  'availability' | 'isCompleted' | 'isSkipped' | 'blocked' | 'blockedReason'
> {
  completed: boolean
  canAct?: boolean
  unavailableReason?: string
  blocked?: LaunchTaskBlocked
}

function blockedReasonFrom(blocked: LaunchTaskBlocked): string {
  if (blocked.kind === 'module-off') {
    const label =
      blocked.productId === 'helpCenter'
        ? 'Help Center'
        : blocked.productId === 'support'
          ? 'Customer support'
          : 'This product'
    return `${label} is turned off for this workspace. Ask a workspace admin to enable it in Settings → Modules.`
  }
  if (blocked.kind === 'plan-limit') {
    return "You've reached the board limit for your plan. Remove a board or upgrade to continue."
  }
  return 'Ask a workspace admin to complete this step.'
}

export function normalizeOutcome(useCase?: UseCaseType | null): OnboardingOutcome {
  return normalizeOnboardingOutcome(useCase) ?? 'product_feedback'
}

export const OUTCOME_TAB_LABEL: Record<OnboardingOutcome, string> = {
  product_feedback: 'Product feedback',
  customer_support: 'Customer support',
  help_center: 'Help Center',
  internal: 'Internal feedback',
}

export const OUTCOME_HOME: Record<OnboardingOutcome, { label: string; href: LaunchTaskHref }> = {
  product_feedback: { label: 'Open feedback', href: '/admin/feedback' },
  customer_support: { label: 'Open support', href: '/admin/inbox' },
  help_center: { label: 'Open Help Center', href: '/admin/help-center' },
  internal: { label: 'Open feedback', href: '/admin/feedback' },
}

export const FIRST_WIN_NOUN: Record<OnboardingOutcome, string> = {
  product_feedback: 'customer post or vote',
  customer_support: 'customer conversation',
  help_center: 'published article',
  internal: 'team idea',
}

const ALLOW_ALL: LaunchPermissions = {
  settingsManage: true,
  boardManage: true,
  memberManage: true,
  brandingManage: true,
  integrationManage: true,
  helpCenterManage: true,
}

function resolvedFeatures(features?: LaunchStatus['features']) {
  return {
    supportInbox: features?.supportInbox ?? false,
    helpCenter: features?.helpCenter ?? false,
    statusPage: features?.statusPage ?? false,
    integrations: features?.integrations ?? true,
    changelog: features?.changelog ?? true,
  }
}

function materializeTask(
  task: LaunchTaskInput,
  outcome: OnboardingOutcome,
  resolutions: OutcomeTaskResolutions | undefined
): LaunchTask {
  const stored = resolutions?.[outcome]?.[task.id]
  const isSkipped =
    !task.completed && (stored?.resolution === 'dismissed' || stored?.resolution === 'deferred')
  const blocked: LaunchTaskBlocked | undefined =
    !task.completed && !isSkipped
      ? (task.blocked ?? (task.canAct === false ? { kind: 'permission' } : undefined))
      : undefined
  const blockedReason = blocked ? (task.unavailableReason ?? blockedReasonFrom(blocked)) : undefined
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    classification: task.classification,
    availability: task.completed ? 'complete' : blockedReason ? 'blocked' : 'available',
    isCompleted: task.completed,
    isSkipped,
    ...(blocked ? { blocked } : {}),
    ...(blockedReason ? { blockedReason } : {}),
    ...(task.href && task.canAct !== false ? { href: task.href } : {}),
    ...(task.actionLabel ? { actionLabel: task.actionLabel } : {}),
    completedLabel: task.completedLabel,
  }
}

export function buildLaunchTasks(
  status: LaunchStatus,
  outcomeOverride?: OnboardingOutcome
): LaunchTask[] {
  const outcome = outcomeOverride ?? normalizeOutcome(status.useCase)
  const permissions = status.permissions ?? ALLOW_ALL
  const features = resolvedFeatures(status.features)
  const boardCapacityBlocked =
    !status.hasBoards && status.maxBoards != null && (status.boardCount ?? 0) >= status.maxBoards
  const board: LaunchTaskInput = {
    id: 'create-board',
    title: outcome === 'internal' ? 'Create a private team board' : 'Create a feedback board',
    description:
      outcome === 'internal'
        ? 'Give teammates a private place to share ideas.'
        : 'Give customers a place to submit and vote on ideas.',
    completed: status.hasBoards,
    canAct: permissions.boardManage,
    ...(boardCapacityBlocked
      ? {
          blocked: { kind: 'plan-limit' as const },
          unavailableReason:
            "You've reached the board limit for your plan. Remove a board or upgrade to continue.",
        }
      : {}),
    classification: 'prerequisite',
    href: '/admin/settings/boards',
    actionLabel: 'Create board',
    completedLabel: 'View boards',
  }
  const widgetDistributed = status.hasWidgetInstalled === true && status.hasWidgetEnabled === true
  const distributionComplete =
    Boolean(status.publicBoardLinkCopiedAt) || widgetDistributed || status.hasFirstWin === true
  const distributeFeedback: LaunchTaskInput = {
    id: 'distribute-feedback',
    title: 'Share your feedback board',
    description: status.publicBoardLinkCopiedAt
      ? 'Your public board link has been copied.'
      : widgetDistributed
        ? `Your feedback widget was found on ${status.widgetOriginHost ?? 'your site'}.`
        : 'Copy the public board link and share it with customers.',
    completed: distributionComplete,
    canAct: permissions.boardManage,
    classification: 'prerequisite',
    actionLabel: 'Copy board link',
    completedLabel: 'Board distributed',
  }
  const publishChangelog: LaunchTaskInput = {
    id: 'publish-changelog',
    title: 'Publish your first update',
    description: 'Drafts stay here. We’ll mark this when you publish.',
    completed: Boolean(status.hasPublishedChangelog),
    canAct: permissions.settingsManage,
    classification: 'prerequisite',
    href: '/admin/changelog',
    actionLabel: 'New update',
    completedLabel: 'Open changelog',
  }
  const connectMessenger: LaunchTaskInput = {
    id: 'connect-messenger',
    title: 'Connect Messenger',
    description: status.hasWidgetInstalled
      ? `Messenger was found on ${status.widgetOriginHost ?? 'your site'}.`
      : 'We’ll mark this when the widget loads on your site.',
    completed:
      status.hasWidgetInstalled === true &&
      status.hasWidgetEnabled === true &&
      features.supportInbox,
    canAct: permissions.settingsManage,
    classification: 'prerequisite',
    href: '/admin/settings/widget/install',
    actionLabel: 'Connect Messenger',
    completedLabel: 'View installation',
  }
  const helpDraft: LaunchTaskInput = {
    id: 'help-article',
    title: 'Write your first article',
    description: 'Draft the first answer your customers should find.',
    completed: Boolean(status.hasHelpArticle),
    canAct: permissions.helpCenterManage,
    classification: 'prerequisite',
    href: '/admin/help-center',
    actionLabel: 'Write article',
    completedLabel: 'Open article',
  }
  const addStatusService: LaunchTaskInput = {
    id: 'add-status-service',
    title: 'Add a service',
    description: 'Name the first thing customers should see on your status page.',
    completed: Boolean(status.hasStatusComponent),
    canAct: permissions.settingsManage,
    classification: 'prerequisite',
    href: '/admin/status',
    actionLabel: 'Add service',
    completedLabel: 'Open status',
  }
  const invite: LaunchTaskInput = {
    id: 'invite-team',
    title: 'Invite a teammate',
    description: 'Bring in someone to help respond, publish, or manage feedback.',
    completed: status.memberCount > 1,
    canAct: permissions.memberManage,
    classification: 'polish',
    href: '/admin/settings/members',
    actionLabel: 'Invite teammate',
    completedLabel: 'Manage team',
  }
  const branding: LaunchTaskInput = {
    id: 'customize-branding',
    title: 'Add your logo',
    description: 'Make your portal, widget, and emails feel like your brand.',
    completed: status.hasBranding,
    canAct: permissions.brandingManage,
    classification: 'polish',
    href: '/admin/settings/portal',
    actionLabel: 'Add logo',
    completedLabel: 'Edit branding',
  }
  const integration: LaunchTaskInput = {
    id: 'connect-integration',
    title: 'Connect an integration',
    description: 'Keep Quackback in sync with the tools your team already uses.',
    completed: Boolean(status.hasIntegration),
    canAct: permissions.integrationManage,
    ...(features.integrations
      ? {}
      : {
          blocked: { kind: 'plan-limit' as const },
          unavailableReason: 'Integrations are not included in your current plan.',
        }),
    classification: 'polish',
    href: '/admin/settings/integrations',
    actionLabel: 'Connect',
    completedLabel: 'Manage integrations',
  }
  const firstWin: LaunchTaskInput = {
    id: 'first-win',
    title:
      outcome === 'customer_support'
        ? 'Receive your first customer conversation'
        : outcome === 'help_center'
          ? 'Publish your first article'
          : outcome === 'internal'
            ? 'Collect your first team idea'
            : 'Receive your first customer post or vote',
    description: 'We’ll mark this complete automatically when it happens.',
    completed: Boolean(status.hasFirstWin),
    classification: 'first_win',
    completedLabel: 'First win reached',
  }

  const inputs: LaunchTaskInput[] = [board]
  if (status.hasPublicBoard) inputs.push(distributeFeedback)
  if (features.changelog) inputs.push(publishChangelog)
  if (features.supportInbox) inputs.push(connectMessenger)
  if (features.helpCenter) inputs.push(helpDraft)
  if (features.statusPage) inputs.push(addStatusService)
  inputs.push(invite, branding, integration, firstWin)

  return inputs.map((task) => materializeTask(task, outcome, status.taskResolutions))
}

export function launchChecklistSummary(
  status: LaunchStatus,
  outcomeOverride?: OnboardingOutcome
): {
  tasks: LaunchTask[]
  skippedTasks: LaunchTask[]
  outcome: OnboardingOutcome
  doneCount: number
  denominator: number
  remaining: number
  blockedCount: number
  allComplete: boolean
  firstWinComplete: boolean
  resolved: boolean
  headline: string
  percent: number
} {
  const outcome = outcomeOverride ?? normalizeOutcome(status.useCase)
  const tasks = buildLaunchTasks(status, outcome)
  const prerequisites = tasks.filter((task) => task.classification === 'prerequisite')
  const skippedTasks = tasks.filter((task) => task.isSkipped && task.classification !== 'first_win')
  const counted = prerequisites.filter((task) => !task.isSkipped)
  const doneCount = counted.filter((task) => task.isCompleted).length
  const remaining = counted.filter((task) => !task.isCompleted).length
  const blockedCount = counted.filter((task) => task.availability === 'blocked').length
  const firstWinComplete = tasks.some(
    (task) => task.classification === 'first_win' && task.isCompleted
  )
  const hasAvailable = counted.some(
    (task) => task.availability === 'available' && !task.isCompleted
  )
  const allComplete = remaining === 0
  const winNoun = FIRST_WIN_NOUN[outcome]
  return {
    tasks,
    skippedTasks,
    outcome,
    doneCount,
    denominator: counted.length,
    remaining,
    blockedCount,
    allComplete,
    firstWinComplete,
    resolved: allComplete,
    percent: counted.length === 0 ? 100 : Math.round((doneCount / counted.length) * 100),
    headline: firstWinComplete
      ? 'You’re up and running'
      : blockedCount > 0 && !hasAvailable
        ? 'One thing needs attention before you can launch'
        : remaining === 0
          ? `You’re ready for your first ${winNoun}`
          : `${remaining} step${remaining === 1 ? '' : 's'} to your first ${winNoun}`,
  }
}

/** Home card visibility. First win no longer holds this. */
export function isLaunchPlanActive(summary: {
  resolved: boolean
  firstWinComplete?: boolean
}): boolean {
  return !summary.resolved
}
