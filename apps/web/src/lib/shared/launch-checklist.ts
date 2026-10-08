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
  /** The private team board a private plan's win is judged on. */
  teamBoardSlug?: string | null
  publicBoardPath?: string | null
  publicBoardLinkCopiedAt?: string | null
  /** When an admin first copied the status page link. */
  statusLinkCopiedAt?: string | null
  hasInternalBoard?: boolean
  boardCount?: number
  maxBoards?: number | null
  memberCount: number
  /** A teammate has been invited, whether or not they have joined yet. */
  hasTeamInvite?: boolean
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
  | '/admin/settings/general'
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
  /** Setup did it, not the person: shown as Ready and left out of progress. */
  isReady: boolean
  blocked?: LaunchTaskBlocked
  blockedReason?: string
  href?: LaunchTaskHref
  /** Search params for {@link href}, for a step that lands on one view of a page. */
  search?: Record<string, string>
  /** Done in place: the step opens this going-live sheet instead of navigating. */
  sheet?: 'invite-team'
  actionLabel?: string
  completedLabel: string
}

interface LaunchTaskInput extends Omit<
  LaunchTask,
  'availability' | 'isCompleted' | 'isSkipped' | 'isReady' | 'blocked' | 'blockedReason'
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
  help_center: 'helpful vote from a visitor',
  internal: 'idea from a teammate',
  status_page: 'subscriber',
}

/** The first win names what it is for the primary goal. */
const FIRST_WIN_WORDING: Record<OnboardingOutcome, { variant: string; title: string }> = {
  product_feedback: { variant: 'feedback', title: 'A customer posts an idea' },
  internal: { variant: 'private', title: 'A teammate posts an idea' },
  customer_support: { variant: 'support', title: 'A customer starts a conversation' },
  help_center: { variant: 'helpCenter', title: 'A customer finds it helpful' },
  status_page: { variant: 'status', title: 'A customer subscribes' },
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
    // Integrations come with a higher plan: offered only when the plan says so.
    integrations: features?.integrations ?? false,
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

/** Steps setup completes on its own: the seeded board and service, and Quinn, on by default. */
const READY_TASK_IDS = new Set(['create-board', 'set-up-quinn', 'add-status-service'])

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
    isReady: task.completed && READY_TASK_IDS.has(task.id),
    ...(blocked ? { blocked } : {}),
    ...(blockedReason ? { blockedReason } : {}),
    ...(task.href && task.canAct !== false ? { href: task.href } : {}),
    ...(task.href && task.search && task.canAct !== false ? { search: task.search } : {}),
    ...(task.sheet && task.canAct !== false ? { sheet: task.sheet } : {}),
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
    title: 'Share your board link',
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
    title: 'Put Messenger on your site',
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
    title: 'Publish your first article',
    description: 'Publish the first answer your customers should find.',
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
    search: { view: 'components' },
    actionLabel: 'Add service',
    completedLabel: 'Open status',
  }
  const shareStatusPage: LaunchTaskInput = {
    id: 'share-status-page',
    title: 'Share your status page',
    description: 'Link it from your footer or docs so customers can subscribe.',
    completed: Boolean(status.statusLinkCopiedAt) || status.hasFirstWin === true,
    canAct: permissions.settingsManage,
    classification: 'prerequisite',
    actionLabel: 'Copy status link',
    completedLabel: 'Status page shared',
  }
  const invite: LaunchTaskInput = {
    id: 'invite-team',
    title: 'Invite your team',
    description: 'Bring in someone to help respond, publish, or manage feedback.',
    // The first invite sent completes the step; joining is up to them.
    completed: status.memberCount > 1 || status.hasTeamInvite === true,
    canAct: permissions.memberManage,
    // A private team board is only useful once the team is in it.
    classification: outcome === 'internal' ? 'prerequisite' : 'polish',
    href: '/admin/settings/members',
    sheet: 'invite-team',
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
    href: '/admin/settings/general',
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
  if (features.statusPage && outcome === 'status_page') inputs.push(shareStatusPage)
  inputs.push(invite, branding)
  // A step the plan does not include is not part of the plan.
  if (features.integrations) inputs.push(integration)
  inputs.push(firstWin)

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
    internal: ['create-board', 'invite-team'],
    customer_support: ['connect-messenger', 'set-up-quinn'],
    help_center: ['help-article'],
    status_page: ['share-status-page', 'add-status-service'],
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

/** The outcome the plan is built around: the primary goal, private feedback as its own. */
export function launchOutcome(status: LaunchStatus): OnboardingOutcome {
  const selected = status.goals?.[0] ?? normalizeOutcome(status.useCase)
  return selected === 'product_feedback' && status.feedbackPrivate ? 'internal' : selected
}

/** Which path a workspace walks: one per goal. */
export type LaunchPathGoal = 'feedback' | 'private' | 'support' | 'helpCenter' | 'status'

const PATH_GOAL: Record<OnboardingOutcome, LaunchPathGoal> = {
  product_feedback: 'feedback',
  internal: 'private',
  customer_support: 'support',
  help_center: 'helpCenter',
  status_page: 'status',
}

/** The goal's one step between the live page and the first win. */
const GOAL_STEP: Record<LaunchPathGoal, readonly string[]> = {
  feedback: ['distribute-feedback', 'create-board'],
  private: ['invite-team'],
  support: ['connect-messenger'],
  helpCenter: ['help-article'],
  status: ['share-status-page'],
}

/** The path's first step: the page setup made live, already done. */
export const LAUNCH_LIVE_STEP: Record<LaunchPathGoal, { id: string; defaultMessage: string }> = {
  feedback: { id: 'onboarding.path.live.feedback', defaultMessage: 'Your board is live' },
  private: { id: 'onboarding.path.live.private', defaultMessage: 'Your team board is ready' },
  support: { id: 'onboarding.path.live.support', defaultMessage: 'Messenger is ready' },
  helpCenter: { id: 'onboarding.path.live.helpCenter', defaultMessage: 'Your help center is live' },
  status: { id: 'onboarding.path.live.status', defaultMessage: 'Your status page is live' },
}

/**
 * Where an admin decides who can see the live page: the real control for each
 * goal (board access, status page visibility, portal visibility). Null where
 * there is nothing to keep private.
 */
export function launchVisibilityHref(goal: LaunchPathGoal, status: LaunchStatus): string | null {
  if (goal === 'feedback' || goal === 'private') {
    const slug = goal === 'private' ? status.teamBoardSlug : status.publicBoardSlug
    return slug
      ? `/admin/settings/boards/${encodeURIComponent(slug)}?tab=access`
      : '/admin/settings/boards'
  }
  if (goal === 'status') return '/admin/settings/status'
  if (goal === 'helpCenter') return '/admin/settings/security/authentication'
  return null
}

/** Steps on the path: the live page, the goal step and the first win. */
export const LAUNCH_PATH_LENGTH = 3

export interface LaunchPath {
  goal: LaunchPathGoal
  /** The goal step, then the first win. The live page is step 1 and always done. */
  steps: [LaunchTask, LaunchTask]
  /** The step the workspace is on, 1-based, out of {@link LAUNCH_PATH_LENGTH}. */
  step: number
  total: number
  /** A customer (or, for a private board, a teammate) has acted: the plan is done. */
  complete: boolean
  /** The one step to lead with, or null once the plan is done. */
  next: LaunchTask | null
  /** Every other step, in plan order. Steps setup did itself are left out. */
  later: LaunchTask[]
}

const isDone = (task: LaunchTask) => task.isCompleted || task.isReady

/**
 * The launch plan as everything shows it: Home, the sidebar dock, the Launch
 * plan page and the setup emails all read this one path and its one count.
 * The plan stays open until the first real win, however many chores are done.
 */
export function launchPath(status: LaunchStatus): LaunchPath {
  const outcome = launchOutcome(status)
  const preferred = PATH_GOAL[outcome]
  const stepIn = (tasks: LaunchTask[], goal: LaunchPathGoal) =>
    GOAL_STEP[goal].map((id) => tasks.find((task) => task.id === id)).find(Boolean)
  let tasks = buildLaunchTasks(status)
  // A goal whose module is off has no step to show: the plan falls back to
  // feedback, built as a real goal so its board steps are in the plan.
  if (!stepIn(tasks, preferred)) {
    const withFeedback = buildLaunchTasks(status, [
      ...(status.goals ?? [launchResolutionKey(status)]),
      'product_feedback',
    ])
    const feedback = withFeedback.filter(
      (task) => GOAL_STEP.feedback.includes(task.id) && !tasks.some((t) => t.id === task.id)
    )
    tasks = [...feedback, ...tasks]
  }
  const win = tasks.find((task) => task.classification === 'first_win')!
  const goal = stepIn(tasks, preferred) ? preferred : 'feedback'
  // A feedback goal always builds create-board, so a step is always found.
  const goalStep = stepIn(tasks, goal)!
  const complete = win.isCompleted
  const step = complete || isDone(goalStep) ? 3 : 2
  const goalOpen = !isDone(goalStep) && !goalStep.isSkipped && goalStep.availability !== 'blocked'
  return {
    goal,
    steps: [goalStep, win],
    step,
    total: LAUNCH_PATH_LENGTH,
    complete,
    next: complete ? null : goalOpen ? goalStep : win,
    later: tasks.filter((task) => task !== goalStep && task !== win && !task.isReady),
  }
}

/** A step still to do: not done, not skipped, and in reach of whoever looks. */
export function isOpenLaunchStep(task: LaunchTask): boolean {
  return !task.isCompleted && !task.isSkipped && task.availability !== 'blocked'
}

/**
 * The plan's other steps still to do, in plan order: every picked goal's
 * step, then the polish. Home names these; the Launch plan page lists them
 * under Later.
 */
export function openLaterSteps(path: LaunchPath): LaunchTask[] {
  return path.later.filter(isOpenLaunchStep)
}

/** The one count: the sidebar dock and the Launch plan page show this. */
export function launchPlanProgress(status: LaunchStatus): {
  step: number
  total: number
  resolved: boolean
} {
  const path = launchPath(status)
  return { step: path.step, total: path.total, resolved: path.complete }
}

/** The plan is open until the first real win. */
export function isLaunchPlanActive(status: LaunchStatus): boolean {
  return !launchPath(status).complete
}
