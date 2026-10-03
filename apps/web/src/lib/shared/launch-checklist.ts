import {
  normalizeOnboardingOutcome,
  type LaunchTaskResolution,
  type OnboardingOutcome,
  type OutcomeTaskResolutions,
  type UseCaseType,
} from '@/lib/shared/db-types'
import type { ProductId } from '@/lib/shared/types/settings'
import type { LaunchWindow } from '@/lib/shared/launch-window'

export interface LaunchPermissions {
  settingsManage: boolean
  boardManage: boolean
  memberManage: boolean
  brandingManage: boolean
  integrationManage: boolean
  helpCenterManage: boolean
  assistantManage: boolean
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
  /** The Agent is on and set to answer customers. */
  hasAgentAnswering?: boolean
  hasHelpArticle?: boolean
  hasPublishedChangelog?: boolean
  hasStatusComponent?: boolean
  hasIntegration?: boolean
  hasFirstWin?: boolean
  firstWinAt?: string | null
  /** The first weeks after setup; null for an established workspace. */
  launchWindow?: LaunchWindow | null
  /** Whether the launch window is open now, by the server's clock. */
  inLaunchWindow?: boolean
  goals?: OnboardingOutcome[]
  feedbackPrivate?: boolean
  useCase?: UseCaseType | null
  taskResolutions?: OutcomeTaskResolutions
  permissions?: LaunchPermissions
  features?: {
    supportInbox: boolean
    helpCenter: boolean
    statusPage: boolean
    integrations: boolean
    changelog?: boolean
    /** Quinn can answer: the plan includes the AI assistant and an AI model is configured. */
    assistant?: boolean
  }
}

export type LaunchTaskHref =
  | '/admin/settings/boards'
  | '/admin/settings/members'
  | '/admin/settings/portal'
  | '/admin/settings/widget/install'
  | '/admin/settings/integrations'
  | '/admin/settings/agent'
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
  /** Which wording of the step this plan uses, when it depends on the goal. */
  variant?: string
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
  status_page: 'Status page',
}

export const OUTCOME_HOME: Record<OnboardingOutcome, { label: string; href: LaunchTaskHref }> = {
  product_feedback: { label: 'Open feedback', href: '/admin/feedback' },
  customer_support: { label: 'Open support', href: '/admin/inbox' },
  help_center: { label: 'Open Help Center', href: '/admin/help-center' },
  internal: { label: 'Open feedback', href: '/admin/feedback' },
  status_page: { label: 'Open status', href: '/admin/status' },
}

export const FIRST_WIN_NOUN: Record<OnboardingOutcome, string> = {
  product_feedback: 'customer post or vote',
  customer_support: 'customer conversation',
  help_center: 'published article',
  internal: 'team idea',
  status_page: 'service',
}

/** The first win names what it is for the primary goal. */
const FIRST_WIN_WORDING: Record<OnboardingOutcome, { variant: string; title: string }> = {
  product_feedback: { variant: 'feedback', title: 'Get your first idea' },
  internal: { variant: 'feedback', title: 'Get your first idea' },
  customer_support: { variant: 'support', title: 'Answer your first conversation' },
  help_center: { variant: 'helpCenter', title: 'Publish your first article' },
  status_page: { variant: 'status', title: 'Add your first service' },
}

const ALLOW_ALL: LaunchPermissions = {
  settingsManage: true,
  boardManage: true,
  memberManage: true,
  brandingManage: true,
  integrationManage: true,
  helpCenterManage: true,
  assistantManage: true,
}

function resolvedFeatures(features?: LaunchStatus['features']) {
  return {
    supportInbox: features?.supportInbox ?? false,
    helpCenter: features?.helpCenter ?? false,
    statusPage: features?.statusPage ?? false,
    integrations: features?.integrations ?? true,
    changelog: features?.changelog ?? true,
    assistant: features?.assistant ?? true,
  }
}

type TaskResolutionMap = Record<string, LaunchTaskResolution>

interface ResolutionIntent {
  goals?: readonly OnboardingOutcome[]
  useCase?: UseCaseType | null
  feedbackPrivate?: boolean
  taskResolutions?: OutcomeTaskResolutions
}

/** The one setup-state key every launch-plan skip is stored under: the primary goal. */
export function launchResolutionKey(intent: ResolutionIntent): OnboardingOutcome {
  return intent.goals?.[0] ?? normalizeOutcome(intent.useCase)
}

/** Private team feedback kept its skips under `internal` before goals existed. */
function legacyResolutionKeys(intent: ResolutionIntent, key: OnboardingOutcome) {
  return key === 'product_feedback' && intent.feedbackPrivate ? (['internal'] as const) : []
}

function taskResolutionsFor(intent: ResolutionIntent, key: OnboardingOutcome): TaskResolutionMap {
  const merged: TaskResolutionMap = {}
  for (const legacy of legacyResolutionKeys(intent, key)) {
    Object.assign(merged, intent.taskResolutions?.[legacy])
  }
  return Object.assign(merged, intent.taskResolutions?.[key])
}

/**
 * Save or clear one skip under the primary goal. Clearing also removes a skip
 * stored under the legacy private-feedback key, so Undo always restores it.
 */
export function withLaunchTaskResolution(
  intent: ResolutionIntent,
  taskId: string,
  resolution: LaunchTaskResolution | null
): OutcomeTaskResolutions | undefined {
  const key = launchResolutionKey(intent)
  const all: OutcomeTaskResolutions = { ...(intent.taskResolutions ?? {}) }
  const keys: OnboardingOutcome[] = resolution ? [key] : [key, ...legacyResolutionKeys(intent, key)]
  for (const target of keys) {
    const tasks = { ...(all[target] ?? {}) }
    if (resolution && target === key) tasks[taskId] = resolution
    else delete tasks[taskId]
    if (Object.keys(tasks).length > 0) all[target] = tasks
    else delete all[target]
  }
  return Object.keys(all).length > 0 ? all : undefined
}

function materializeTask(task: LaunchTaskInput, resolutions: TaskResolutionMap): LaunchTask {
  const stored = resolutions[task.id]
  const isSkipped =
    !task.completed && (stored?.resolution === 'dismissed' || stored?.resolution === 'deferred')
  const blocked: LaunchTaskBlocked | undefined =
    !task.completed && !isSkipped
      ? (task.blocked ?? (task.canAct === false ? { kind: 'permission' } : undefined))
      : undefined
  const blockedReason = blocked ? (task.unavailableReason ?? blockedReasonFrom(blocked)) : undefined
  return {
    id: task.id,
    ...(task.variant ? { variant: task.variant } : {}),
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

function buildOutcomeTasks(
  status: LaunchStatus,
  outcomeOverride: OnboardingOutcome | undefined,
  resolutions: TaskResolutionMap
): LaunchTask[] {
  const selectedOutcome = outcomeOverride ?? normalizeOutcome(status.useCase)
  const outcome =
    selectedOutcome === 'product_feedback' && status.feedbackPrivate ? 'internal' : selectedOutcome
  const permissions = status.permissions ?? ALLOW_ALL
  const features = resolvedFeatures(status.features)
  const boardCapacityBlocked =
    !status.hasBoards && status.maxBoards != null && (status.boardCount ?? 0) >= status.maxBoards
  const board: LaunchTaskInput = {
    id: 'create-board',
    ...(outcome === 'internal' ? { variant: 'private' } : {}),
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
  const setUpQuinn: LaunchTaskInput = {
    id: 'set-up-quinn',
    title: 'Set up Quinn',
    description: 'Quinn answers customers in Messenger. Check its name, voice and knowledge.',
    completed: status.hasAgentAnswering === true,
    canAct: permissions.assistantManage,
    classification: 'prerequisite',
    href: '/admin/settings/agent',
    actionLabel: 'Set up Quinn',
    completedLabel: 'Open Agent',
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
    ...FIRST_WIN_WORDING[outcome],
    description: 'We’ll mark this complete automatically when it happens.',
    completed: Boolean(status.hasFirstWin),
    classification: 'first_win',
    completedLabel: 'First win reached',
  }

  const inputs: LaunchTaskInput[] = [board]
  if (status.hasPublicBoard) inputs.push(distributeFeedback)
  if (features.changelog) inputs.push(publishChangelog)
  if (features.supportInbox) inputs.push(connectMessenger)
  if (features.supportInbox && features.assistant) inputs.push(setUpQuinn)
  if (features.helpCenter) inputs.push(helpDraft)
  if (features.statusPage) inputs.push(addStatusService)
  inputs.push(invite, branding, integration, firstWin)

  return inputs.map((task) => materializeTask(task, resolutions))
}

/** Merge selected product work in goal order, then shared polish and the primary win. */
export function buildLaunchTasks(
  status: LaunchStatus,
  goalsOverride?: readonly OnboardingOutcome[] | OnboardingOutcome
): LaunchTask[] {
  if (typeof goalsOverride === 'string') {
    return buildOutcomeTasks(status, goalsOverride, taskResolutionsFor(status, goalsOverride))
  }
  const goals = goalsOverride ?? status.goals
  if (!goals?.length) {
    return buildOutcomeTasks(
      status,
      undefined,
      taskResolutionsFor(status, launchResolutionKey(status))
    )
  }
  // Every skip is read from one key, whichever goal's set a task came from.
  const resolutions = taskResolutionsFor(status, launchResolutionKey({ ...status, goals }))
  const taskIds: Record<OnboardingOutcome, readonly string[]> = {
    product_feedback: ['create-board', 'distribute-feedback'],
    internal: ['create-board'],
    customer_support: ['connect-messenger', 'set-up-quinn'],
    help_center: ['help-article'],
    status_page: ['add-status-service'],
  }
  const tasks: LaunchTask[] = []
  const seen = new Set<string>()
  for (const goal of goals) {
    const outcome = goal === 'product_feedback' && status.feedbackPrivate ? 'internal' : goal
    for (const task of buildOutcomeTasks(status, outcome, resolutions)) {
      if (!taskIds[outcome].includes(task.id) || seen.has(task.id)) continue
      tasks.push(task.id === 'set-up-quinn' ? { ...task, classification: 'polish' } : task)
      seen.add(task.id)
    }
  }
  const shared = buildOutcomeTasks(status, goals[0], resolutions).filter(
    (task) =>
      task.classification === 'polish' ||
      task.classification === 'first_win' ||
      (task.id === 'publish-changelog' && goals.includes('product_feedback'))
  )
  for (const task of shared) {
    if (seen.has(task.id)) continue
    tasks.push(task.id === 'publish-changelog' ? { ...task, classification: 'polish' } : task)
    seen.add(task.id)
  }
  return [
    ...tasks.filter((task) => task.classification === 'prerequisite'),
    ...tasks.filter((task) => task.classification === 'polish'),
    ...tasks.filter((task) => task.classification === 'first_win'),
  ]
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
  const selectedOutcome = outcomeOverride ?? status.goals?.[0] ?? normalizeOutcome(status.useCase)
  const outcome =
    selectedOutcome === 'product_feedback' && status.feedbackPrivate ? 'internal' : selectedOutcome
  const tasks = buildLaunchTasks(status, outcomeOverride)
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

/**
 * Progress as the sidebar dock and the Launch plan page show it: every row of
 * the plan, done or skipped, out of all rows. `resolved` hides the dock.
 */
export function launchPlanProgress(status: LaunchStatus): {
  done: number
  total: number
  resolved: boolean
} {
  const summary = launchChecklistSummary(status)
  return {
    done: summary.tasks.filter((task) => task.isCompleted || task.isSkipped).length,
    total: summary.tasks.length,
    resolved: summary.resolved,
  }
}

export type LaunchPlanGroupId =
  'product_feedback' | 'customer_support' | 'help_center' | 'status_page' | 'polish'

/** The goal whose work a task is. Anything else is polish. */
const TASK_GROUP: Record<string, Exclude<LaunchPlanGroupId, 'polish'>> = {
  'create-board': 'product_feedback',
  'distribute-feedback': 'product_feedback',
  'connect-messenger': 'customer_support',
  'set-up-quinn': 'customer_support',
  'help-article': 'help_center',
  'add-status-service': 'status_page',
}

const GOAL_GROUPS = ['product_feedback', 'customer_support', 'help_center', 'status_page'] as const

/**
 * The plan as the Launch plan page lists it: a group for each goal in the
 * order chosen, the first win under the primary goal, then Polish.
 */
export function launchPlanGroups(
  status: LaunchStatus
): { id: LaunchPlanGroupId; tasks: LaunchTask[] }[] {
  const { tasks } = launchChecklistSummary(status)
  const primary = launchResolutionKey(status)
  const asGroup = (goal: OnboardingOutcome): LaunchPlanGroupId =>
    goal === 'internal' ? 'product_feedback' : goal
  const groupOf = (task: LaunchTask): LaunchPlanGroupId =>
    task.classification === 'first_win'
      ? asGroup(primary)
      : task.classification === 'prerequisite' && task.id === 'invite-team'
        ? 'product_feedback'
        : (TASK_GROUP[task.id] ?? 'polish')
  const order: LaunchPlanGroupId[] = []
  for (const id of [
    ...(status.goals?.length ? status.goals : [primary]).map(asGroup),
    ...GOAL_GROUPS,
    'polish' as const,
  ]) {
    if (!order.includes(id)) order.push(id)
  }
  return order
    .map((id) => ({ id, tasks: tasks.filter((task) => groupOf(task) === id) }))
    .filter((group) => group.tasks.length > 0)
}

/** Home card visibility. First win no longer holds this. */
export function isLaunchPlanActive(summary: {
  resolved: boolean
  firstWinComplete?: boolean
}): boolean {
  return !summary.resolved
}
