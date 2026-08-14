import type { OnboardingOutcome, StartingPointState } from '@/lib/shared/db-types'
import {
  buildLaunchTasks,
  normalizeOutcome,
  type LaunchStatus,
} from '@/lib/shared/launch-checklist'

export type ActivationSurface =
  | 'onboarding_handoff'
  | 'feedback_empty'
  | 'conversation_empty'
  | 'launch_plan'

export type ActivationAction =
  | {
      id: string
      outcome: OnboardingOutcome
      label: string
      kind: 'link'
      destination: string
    }
  | {
      id: string
      outcome: OnboardingOutcome
      label: string
      kind: 'copy'
      payload: { boardId: string; path: string }
    }
  | {
      id: string
      outcome: OnboardingOutcome
      label: string
      kind: 'external'
      destination: string
    }

export interface ActivationActionContext {
  surface: ActivationSurface
  status: LaunchStatus
  startingPoint?: StartingPointState | null
}

function copyBoardAction(
  outcome: OnboardingOutcome,
  status: LaunchStatus
): ActivationAction | null {
  if (!status.publicBoardId || !status.publicBoardPath) return null
  return {
    id: 'copy-board-link',
    outcome,
    label: 'Copy board link',
    kind: 'copy',
    payload: { boardId: status.publicBoardId, path: status.publicBoardPath },
  }
}

function safeSiteDestination(hostname: string | null | undefined): string | null {
  const host = hostname?.trim()
  if (!host || host.includes('/') || host.includes('@') || /\s/.test(host)) return null
  return `https://${host}`
}

/**
 * Select the one outcome-specific action a surface may promote. This is pure:
 * callers own rendering, clipboard behavior, navigation, and event emission.
 */
export function selectActivationAction({
  surface,
  status,
  startingPoint,
}: ActivationActionContext): ActivationAction | null {
  const outcome = startingPoint?.outcome ?? normalizeOutcome(status.useCase)

  if (surface === 'feedback_empty') {
    if (!status.hasPublicBoard) {
      return {
        id: 'create-feedback-board',
        outcome,
        label: 'Create feedback board',
        kind: 'link',
        destination: '/admin/settings/boards',
      }
    }
    if (!status.publicBoardLinkCopiedAt && !status.hasWidgetInstalled && !status.hasFirstWin) {
      return copyBoardAction(outcome, status)
    }
    return null
  }

  if (surface === 'conversation_empty') {
    if (outcome !== 'customer_support' || status.hasFirstWin) return null
    if (!status.hasWidgetInstalled) {
      return {
        id: 'connect-messenger',
        outcome,
        label: 'Connect Messenger',
        kind: 'link',
        destination: '/admin/settings/widget/install',
      }
    }
    const destination = safeSiteDestination(status.widgetOriginHost)
    return destination
      ? {
          id: 'open-installed-site',
          outcome,
          label: 'Open your site',
          kind: 'external',
          destination,
        }
      : null
  }

  if (surface === 'onboarding_handoff') {
    if (!startingPoint) return null
    if (startingPoint.resolution === 'deferred' || startingPoint.resolution === 'unavailable') {
      return {
        id: 'open-launch-plan',
        outcome,
        label: 'View your launch plan',
        kind: 'link',
        destination: '/admin/getting-started',
      }
    }
    if (outcome === 'product_feedback') return copyBoardAction(outcome, status)
    if (outcome === 'customer_support') {
      return {
        id: 'connect-messenger',
        outcome,
        label: 'Connect Messenger',
        kind: 'link',
        destination: '/admin/settings/widget/install',
      }
    }
    if (outcome === 'help_center' && startingPoint.resourceId) {
      return {
        id: 'continue-help-article',
        outcome,
        label: 'Continue the article',
        kind: 'link',
        destination: `/admin/help-center/articles/${startingPoint.resourceId}`,
      }
    }
    if (outcome === 'internal') {
      return {
        id: 'invite-teammate',
        outcome,
        label: 'Invite a teammate',
        kind: 'link',
        destination: '/admin/settings/members',
      }
    }
    return {
      id: 'open-launch-plan',
      outcome,
      label: 'View your launch plan',
      kind: 'link',
      destination: '/admin/getting-started',
    }
  }

  const nextTask = buildLaunchTasks(status, outcome).find(
    (task) =>
      task.classification === 'prerequisite' &&
      !task.isCompleted &&
      !task.isDeferred &&
      task.availability === 'available'
  )
  if (!nextTask) return null
  if (nextTask.id === 'distribute-feedback') return copyBoardAction(outcome, status)
  if (!nextTask.href) return null
  return {
    id: nextTask.id,
    outcome,
    label: nextTask.actionLabel ?? nextTask.title,
    kind: 'link',
    destination: nextTask.href,
  }
}
