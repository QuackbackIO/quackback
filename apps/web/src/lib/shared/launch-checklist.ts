/**
 * Launch checklist task definitions — shared by Getting Started page and
 * the admin shell badge. Outcome-aware: order and tasks follow the ICP
 * outcome chosen in onboarding (setupState.useCase), but any outcome's
 * checklist can be rendered on demand (see the Getting Started tabs) by
 * passing an explicit outcome override.
 *
 * Tasks can be explicitly skipped (distinct from completed) — skipping is
 * persisted in setupState.skippedLaunchTasks via toggleLaunchTaskSkipFn.
 */
import {
  normalizeOnboardingOutcome,
  type OnboardingOutcome,
  type UseCaseType,
} from '@/lib/shared/db-types'

export interface LaunchStatus {
  hasBoards: boolean
  memberCount: number
  hasBranding: boolean
  hasWidgetEnabled: boolean
  hasMessengerEnabled?: boolean
  hasHelpArticle?: boolean
  hasStatusComponent?: boolean
  hasIntegration?: boolean
  /** Raw setupState.useCase (may be legacy) */
  useCase?: UseCaseType | null
  /** Task ids explicitly dismissed via the checklist's Skip control */
  skippedLaunchTasks?: string[]
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

export interface LaunchTask {
  id: string
  title: string
  description: string
  isCompleted: boolean
  /** Explicitly dismissed by the admin — counts toward "done" but isn't isCompleted */
  isSkipped: boolean
  href: LaunchTaskHref
  actionLabel: string
  completedLabel: string
}

type LaunchTaskBase = Omit<LaunchTask, 'isSkipped'>

/**
 * Map stored useCase (incl. legacy) onto an onboarding outcome, defaulting
 * unset/unrecognized values to product_feedback (the checklist always needs
 * an outcome to render). Thin wrapper around the shared normalizer, which
 * itself returns undefined in those cases so other callers can pick their
 * own default.
 */
export function normalizeOutcome(useCase?: UseCaseType | null): OnboardingOutcome {
  return normalizeOnboardingOutcome(useCase) ?? 'product_feedback'
}

/** Short label for each outcome, used by the Getting Started tabs. */
export const OUTCOME_TAB_LABEL: Record<OnboardingOutcome, string> = {
  product_feedback: 'Product feedback',
  customer_support: 'Customer support',
  help_center: 'Help center',
  internal: 'Internal',
}

/** Where "all done" should send an admin, per outcome — matches its home surface. */
export const OUTCOME_HOME: Record<OnboardingOutcome, { label: string; href: LaunchTaskHref }> = {
  product_feedback: { label: 'Open Feedback', href: '/admin/feedback' },
  customer_support: { label: 'Open Support', href: '/admin/inbox' },
  help_center: { label: 'Open Help Center', href: '/admin/help-center' },
  internal: { label: 'Open Feedback', href: '/admin/feedback' },
}

/**
 * Build ordered launch tasks for a given outcome. Pass `outcomeOverride` to
 * render a different outcome's checklist than the workspace's stored one
 * (e.g. the Getting Started tabs) — task completion always reflects real
 * workspace state, only the selection/order of tasks changes.
 */
export function buildLaunchTasks(
  status: LaunchStatus,
  outcomeOverride?: OnboardingOutcome
): LaunchTask[] {
  const outcome = outcomeOverride ?? normalizeOutcome(status.useCase)
  const tasks: LaunchTaskBase[] = []

  const board: LaunchTaskBase = {
    id: 'create-board',
    title: 'Create a feedback board',
    description: 'A place for customers to submit and vote on ideas',
    isCompleted: status.hasBoards,
    href: '/admin/settings/boards',
    actionLabel: 'Create board',
    completedLabel: 'View boards',
  }

  const widget: LaunchTaskBase = {
    id: 'add-to-site',
    title: 'Add Quackback to your site',
    description: 'Embed the widget so customers can reach you',
    isCompleted: status.hasWidgetEnabled,
    href: '/admin/settings/widget',
    actionLabel: 'Add to site',
    completedLabel: 'Manage widget',
  }

  const messenger: LaunchTaskBase = {
    id: 'messenger',
    title: 'Let customers message you',
    description: 'Turn on Messenger so chats land in Support',
    isCompleted: Boolean(status.hasMessengerEnabled),
    href: '/admin/settings/widget',
    actionLabel: 'Turn on',
    completedLabel: 'Manage messenger',
  }

  const helpArticle: LaunchTaskBase = {
    id: 'help-article',
    title: 'Write your first article',
    description: 'Answers customers can find without opening a ticket',
    isCompleted: Boolean(status.hasHelpArticle),
    href: '/admin/help-center',
    actionLabel: 'New article',
    completedLabel: 'Open Help Center',
  }

  const invite: LaunchTaskBase = {
    id: 'invite-team',
    title: 'Invite a teammate',
    description: 'Collaborate on feedback and support together',
    isCompleted: status.memberCount > 1,
    href: '/admin/settings/members',
    actionLabel: 'Invite',
    completedLabel: 'Manage team',
  }

  const branding: LaunchTaskBase = {
    id: 'customize-branding',
    title: 'Add your logo',
    description: 'Match the portal and emails to your brand',
    isCompleted: status.hasBranding,
    href: '/admin/settings/branding',
    actionLabel: 'Add logo',
    completedLabel: 'Edit branding',
  }

  const statusComponent: LaunchTaskBase = {
    id: 'status-component',
    title: 'Set up a status page',
    description: 'Show customers your uptime and any active incidents',
    isCompleted: Boolean(status.hasStatusComponent),
    href: '/admin/status',
    actionLabel: 'Add component',
    completedLabel: 'Manage status page',
  }

  const integration: LaunchTaskBase = {
    id: 'connect-integration',
    title: 'Connect an integration',
    description: 'Sync with GitHub, Slack, or your other tools',
    isCompleted: Boolean(status.hasIntegration),
    href: '/admin/settings/integrations',
    actionLabel: 'Connect',
    completedLabel: 'Manage integrations',
  }

  // Outcome-first ordering (first win path), with status page + integrations
  // as optional polish at the tail. Internal skips both — there's no external
  // customer to show a status page to or feature-request sync to run.
  switch (outcome) {
    case 'customer_support':
      tasks.push(messenger, widget, board, invite, branding, statusComponent, integration)
      break
    case 'help_center':
      tasks.push(helpArticle, branding, invite, board, statusComponent, integration)
      break
    case 'internal':
      tasks.push(board, invite, branding)
      break
    case 'product_feedback':
    default:
      tasks.push(board, widget, invite, branding, statusComponent, integration)
      break
  }

  const skipped = new Set(status.skippedLaunchTasks ?? [])

  return tasks.map((t) => ({ ...t, isSkipped: skipped.has(t.id) }))
}

export function launchChecklistSummary(
  status: LaunchStatus,
  outcomeOverride?: OnboardingOutcome
): {
  tasks: LaunchTask[]
  outcome: OnboardingOutcome
  /** Tasks resolved one way or another — completed or explicitly skipped */
  doneCount: number
  remaining: number
  allComplete: boolean
  headline: string
} {
  const outcome = outcomeOverride ?? normalizeOutcome(status.useCase)
  const tasks = buildLaunchTasks(status, outcome)
  const doneCount = tasks.filter((t) => t.isCompleted || t.isSkipped).length
  const remaining = tasks.length - doneCount

  const winLine =
    outcome === 'customer_support'
      ? 'Get your first conversation'
      : outcome === 'help_center'
        ? 'Publish your first article'
        : outcome === 'internal'
          ? 'Collect your first internal idea'
          : 'Get your first customer response'

  return {
    tasks,
    outcome,
    doneCount,
    remaining,
    allComplete: remaining === 0,
    headline:
      remaining === 0
        ? 'Ready for day-to-day work'
        : `${winLine} · ${remaining} step${remaining === 1 ? '' : 's'} left`,
  }
}
