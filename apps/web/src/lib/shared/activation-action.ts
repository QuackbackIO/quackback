import type { OnboardingOutcome, StartingPointState } from '@/lib/shared/db-types'
import { normalizeOutcome, type LaunchStatus } from '@/lib/shared/launch-checklist'

export type ActivationSurface =
  'onboarding_handoff' | 'feedback_empty' | 'conversation_empty' | 'launch_plan'

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

export function copyBoardLinkAction(
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
      if (status.permissions?.boardManage === false) return null
      return {
        id: 'create-feedback-board',
        outcome,
        label: 'Create feedback board',
        kind: 'link',
        destination: '/admin/settings/boards',
      }
    }
    if (!status.publicBoardLinkCopiedAt && !status.hasWidgetInstalled && !status.hasFirstWin) {
      if (status.permissions?.boardManage === false) return null
      return copyBoardLinkAction(outcome, status)
    }
    return null
  }

  if (surface === 'conversation_empty') {
    if (outcome !== 'customer_support' || status.hasFirstWin) return null
    if (!status.hasWidgetInstalled) {
      if (status.permissions?.settingsManage === false) return null
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
    if (outcome === 'product_feedback') {
      return (
        copyBoardLinkAction(outcome, status) ?? {
          id: 'open-feedback-board',
          outcome,
          label: 'Open your board',
          kind: 'link',
          destination: '/admin/feedback',
        }
      )
    }
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

  return null
}

/**
 * Ready-step CTAs. The handoff must always have a way into the workspace;
 * a copyable board link is a share action, not the only exit.
 */
export function resolveOnboardingHandoffCtas(input: Omit<ActivationActionContext, 'surface'>): {
  primary: Exclude<ActivationAction, { kind: 'copy' }>
  share: Extract<ActivationAction, { kind: 'copy' }> | null
} {
  const selected = selectActivationAction({ ...input, surface: 'onboarding_handoff' })
  const outcome = input.startingPoint?.outcome ?? normalizeOutcome(input.status.useCase)
  if (selected?.kind === 'copy') {
    return {
      primary: {
        id: 'open-feedback-board',
        outcome,
        label: 'Open your board',
        kind: 'link',
        destination: '/admin/feedback',
      },
      share: selected,
    }
  }
  if (selected) return { primary: selected, share: null }
  return {
    primary: {
      id: 'open-workspace',
      outcome,
      label: 'Go to your workspace',
      kind: 'link',
      destination: '/admin/getting-started',
    },
    share: null,
  }
}
