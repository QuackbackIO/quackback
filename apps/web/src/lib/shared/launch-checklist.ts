import {
  normalizeOnboardingOutcome,
  type OnboardingOutcome,
  type OutcomeTaskResolutions,
  type UseCaseType,
} from '@/lib/shared/db-types'

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
  hasInternalBoard?: boolean
  boardCount?: number
  maxBoards?: number | null
  memberCount: number
  hasBranding: boolean
  hasWidgetEnabled: boolean
  hasWidgetInstalled?: boolean
  widgetLastSeenAt?: string | null
  widgetOriginHost?: string | null
  hasMessengerEnabled?: boolean
  hasHelpArticle?: boolean
  hasPublishedHelpArticle?: boolean
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
  }
}

export type LaunchTaskHref =
  | '/admin/settings/boards'
  | '/admin/settings/members'
  | '/admin/settings/branding'
  | '/admin/settings/widget'
  | '/admin/settings/conversations'
  | '/admin/settings/integrations'
  | '/admin/help-center'
  | '/admin/status'
  | '/admin/feedback'
  | '/admin/inbox'

export type LaunchTaskAvailability = 'available' | 'blocked' | 'complete'
export type LaunchTaskClassification = 'prerequisite' | 'polish' | 'first_win'

export interface LaunchTask {
  id: string
  title: string
  description: string
  availability: LaunchTaskAvailability
  classification: LaunchTaskClassification
  isCompleted: boolean
  isDeferred: boolean
  isDismissed: boolean
  blockedReason?: string
  href?: LaunchTaskHref
  actionLabel?: string
  completedLabel: string
}

interface LaunchTaskInput extends Omit<
  LaunchTask,
  'availability' | 'isCompleted' | 'isDeferred' | 'isDismissed' | 'blockedReason'
> {
  completed: boolean
  canAct?: boolean
  unavailableReason?: string
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

const ALLOW_ALL: LaunchPermissions = {
  settingsManage: true,
  boardManage: true,
  memberManage: true,
  brandingManage: true,
  integrationManage: true,
  helpCenterManage: true,
}

function materializeTask(
  task: LaunchTaskInput,
  outcome: OnboardingOutcome,
  resolutions: OutcomeTaskResolutions | undefined
): LaunchTask {
  const stored = resolutions?.[outcome]?.[task.id]
  const isDeferred = !task.completed && stored?.resolution === 'deferred'
  const isDismissed =
    !task.completed && task.classification === 'polish' && stored?.resolution === 'dismissed'
  const blockedReason =
    !task.completed && !isDismissed
      ? (task.unavailableReason ??
        (task.canAct === false ? 'Ask a workspace admin to complete this step.' : undefined))
      : undefined
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    classification: task.classification,
    availability: task.completed ? 'complete' : blockedReason ? 'blocked' : 'available',
    isCompleted: task.completed,
    isDeferred,
    isDismissed,
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
  const features = status.features ?? {
    supportInbox: true,
    helpCenter: true,
    statusPage: true,
    integrations: true,
  }
  const hasGoalBoard =
    outcome === 'internal'
      ? (status.hasInternalBoard ?? status.hasBoards)
      : (status.hasPublicBoard ?? status.hasBoards)
  const boardCapacityBlocked =
    !hasGoalBoard && status.maxBoards != null && (status.boardCount ?? 0) >= status.maxBoards
  const board: LaunchTaskInput = {
    id: 'create-board',
    title: outcome === 'internal' ? 'Create a private team board' : 'Create a feedback board',
    description:
      outcome === 'internal'
        ? 'Give teammates a private place to share ideas.'
        : 'Give customers a place to submit and vote on ideas.',
    completed: hasGoalBoard,
    canAct: permissions.boardManage,
    unavailableReason: boardCapacityBlocked
      ? "You've reached the board limit for your plan. Remove a board or upgrade to continue."
      : undefined,
    classification: 'prerequisite',
    href: '/admin/settings/boards',
    actionLabel: 'Create board',
    completedLabel: 'View boards',
  }
  const widgetInstalled: LaunchTaskInput = {
    id: outcome === 'customer_support' ? 'install-messenger' : 'add-to-site',
    title: outcome === 'customer_support' ? 'Install Messenger' : 'Share or install feedback',
    description: status.hasWidgetEnabled
      ? status.widgetLastSeenAt
        ? `Installed on ${status.widgetOriginHost ?? 'your site'}.`
        : 'Add the widget to your website so customers can reach you.'
      : 'Set up the widget, then add it to your website.',
    completed: status.hasWidgetInstalled === true,
    canAct: permissions.settingsManage,
    classification: 'prerequisite',
    href: '/admin/settings/widget',
    actionLabel: 'Install widget',
    completedLabel: 'View widget setup',
  }
  const messenger: LaunchTaskInput = {
    id: 'messenger',
    title: 'Configure Messenger',
    description: 'Choose how customers can start and continue conversations.',
    completed: Boolean(status.hasMessengerEnabled),
    canAct: permissions.settingsManage,
    unavailableReason: features.supportInbox
      ? undefined
      : 'Customer support is turned off for this workspace. Ask a workspace admin to enable it.',
    classification: 'prerequisite',
    href: '/admin/settings/widget',
    actionLabel: 'Configure',
    completedLabel: 'Manage Messenger',
  }
  const helpDraft: LaunchTaskInput = {
    id: 'help-article',
    title: 'Prepare your first article',
    description: 'Turn your draft into a useful answer for customers.',
    completed: Boolean(status.hasHelpArticle),
    canAct: permissions.helpCenterManage,
    unavailableReason: features.helpCenter
      ? undefined
      : 'Help Center is turned off for this workspace. Ask a workspace admin to enable it.',
    classification: 'prerequisite',
    href: '/admin/help-center',
    actionLabel: 'Continue article',
    completedLabel: 'Open article',
  }
  const invite: LaunchTaskInput = {
    id: 'invite-team',
    title: 'Invite a teammate',
    description: 'Bring in someone to help respond, publish, or manage feedback.',
    completed: status.memberCount > 1,
    canAct: permissions.memberManage,
    classification: 'prerequisite',
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
    href: '/admin/settings/branding',
    actionLabel: 'Add logo',
    completedLabel: 'Edit branding',
  }
  const integration: LaunchTaskInput = {
    id: 'connect-integration',
    title: 'Connect an integration',
    description: 'Keep Quackback in sync with the tools your team already uses.',
    completed: Boolean(status.hasIntegration),
    canAct: permissions.integrationManage,
    unavailableReason: features.integrations
      ? undefined
      : 'Integrations are not included in your current plan.',
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

  let inputs: LaunchTaskInput[]
  switch (outcome) {
    case 'customer_support':
      inputs = [messenger, widgetInstalled, invite, branding, integration, firstWin]
      break
    case 'help_center':
      inputs = [helpDraft, invite, branding, firstWin]
      break
    case 'internal':
      inputs = [board, invite, branding, firstWin]
      break
    case 'product_feedback':
    default:
      inputs = [board, widgetInstalled, invite, branding, integration, firstWin]
      break
  }

  const tasks = inputs.map((task) => materializeTask(task, outcome, status.taskResolutions))
  const hasOtherActionablePrerequisite = tasks.some(
    (task) =>
      task.classification === 'prerequisite' &&
      task.availability === 'available' &&
      !task.isDeferred
  )
  if (!hasOtherActionablePrerequisite) return tasks

  const prerequisites = tasks.filter((task) => task.classification === 'prerequisite')
  return [
    ...prerequisites.filter((task) => !task.isDeferred),
    ...prerequisites.filter((task) => task.isDeferred),
    ...tasks.filter((task) => task.classification !== 'prerequisite'),
  ]
}

export function launchChecklistSummary(
  status: LaunchStatus,
  outcomeOverride?: OnboardingOutcome
): {
  tasks: LaunchTask[]
  outcome: OnboardingOutcome
  doneCount: number
  denominator: number
  remaining: number
  blockedCount: number
  allComplete: boolean
  firstWinComplete: boolean
  resolved: boolean
  headline: string
} {
  const outcome = outcomeOverride ?? normalizeOutcome(status.useCase)
  const tasks = buildLaunchTasks(status, outcome)
  const availableSteps = tasks.filter(
    (task) => task.classification === 'prerequisite' && task.availability !== 'blocked'
  )
  const doneCount = availableSteps.filter((task) => task.isCompleted).length
  const remaining = availableSteps.filter((task) => !task.isCompleted).length
  const blockedCount = tasks.filter(
    (task) => task.classification === 'prerequisite' && task.availability === 'blocked'
  ).length
  const firstWinComplete = tasks.some(
    (task) => task.classification === 'first_win' && task.isCompleted
  )
  const allComplete = remaining === 0
  return {
    tasks,
    outcome,
    doneCount,
    denominator: availableSteps.length,
    remaining,
    blockedCount,
    allComplete,
    firstWinComplete,
    resolved: allComplete && firstWinComplete,
    headline: firstWinComplete
      ? 'You’re up and running'
      : blockedCount > 0 && remaining === 0
        ? 'Your workspace needs attention before you can launch'
        : allComplete
          ? 'Everything is ready for your first result'
          : `${remaining} setup step${remaining === 1 ? '' : 's'} to go`,
  }
}
