import { useState, type ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  ActivationActionButton,
  copyWithFallback,
} from '@/components/admin/activation-action-button'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import { buildLaunchTasks, launchOutcome, type LaunchStatus } from '@/lib/shared/launch-checklist'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { launchStatusQuery } from './use-launch-plan'

/** Where Messenger's install snippet and steps live. */
export const MESSENGER_INSTALL_PATH = '/admin/settings/widget/install'

/**
 * The real action that moves a goal towards its first customer: share the
 * board, put Messenger on the site, write an article, add a service.
 */
export type GoalAction = 'share-board' | 'install-messenger' | 'article' | 'service'

/** The action for the workspace's first goal. */
export function goalAction(goals: readonly OnboardingOutcome[]): GoalAction {
  const primary = goals[0] ?? 'product_feedback'
  if (primary === 'help_center') return 'article'
  if (primary === 'status_page') return 'service'
  if (primary === 'customer_support') return 'install-messenger'
  return 'share-board'
}

/** Copies the board link, for the feedback goals; nothing without a public board. */
function ShareBoardButton({
  status,
  variant,
}: {
  status: LaunchStatus
  variant: 'default' | 'outline'
}) {
  const copy = copyBoardLinkAction(launchOutcome(status), status)
  if (!copy) return null
  return (
    <ActivationActionButton action={copy} surface="launch_plan" variant={variant} className="h-8" />
  )
}

function InstallMessengerLink({
  variant,
  onLeave,
}: {
  variant: 'default' | 'outline'
  onLeave?: () => void
}) {
  return (
    <Button asChild size="sm" variant={variant} className="h-8">
      <Link to={MESSENGER_INSTALL_PATH} onClick={onLeave}>
        <FormattedMessage
          id="onboarding.goalAction.installMessenger"
          defaultMessage="Put Messenger on your site"
        />
      </Link>
    </Button>
  )
}

/** The tour end card's one action, for the first goal. */
export function TourEndGoalAction({
  goals,
  onLeave,
}: {
  goals: readonly OnboardingOutcome[]
  /** Closes the end card before an action that opens a page. */
  onLeave: () => void
}): ReactNode {
  const { data: status } = useQuery(launchStatusQuery())
  const action = goalAction(goals)
  if (action === 'share-board') {
    return status ? <ShareBoardButton status={status} variant="default" /> : null
  }
  if (action === 'install-messenger')
    return <InstallMessengerLink variant="default" onLeave={onLeave} />
  return (
    <Button asChild>
      {action === 'article' ? (
        <Link to="/admin/help-center" onClick={onLeave}>
          <FormattedMessage
            id="onboarding.tour.stop.try.article"
            defaultMessage="Write your first article"
          />
        </Link>
      ) : (
        <Link to="/admin/status" search={{ view: 'components' }} onClick={onLeave}>
          <FormattedMessage id="onboarding.tour.stop.try.service" defaultMessage="Add a service" />
        </Link>
      )}
    </Button>
  )
}

const PORTAL_LINKS = {
  helpCenter: {
    path: '/hc',
    label: {
      id: 'onboarding.goalAction.copyHelpCenterLink',
      defaultMessage: 'Copy help center link',
    },
    copied: {
      id: 'onboarding.goalAction.helpCenterLinkCopied',
      defaultMessage: 'Help center link copied',
    },
  },
  status: {
    path: '/status',
    label: { id: 'onboarding.goalAction.copyStatusLink', defaultMessage: 'Copy status link' },
    copied: {
      id: 'onboarding.goalAction.statusLinkCopied',
      defaultMessage: 'Status page link copied',
    },
  },
} as const

/** Copies a public page's link, as often as it is wanted: sharing it is how customers arrive. */
function CopyPortalLinkButton({
  page,
  variant,
}: {
  page: keyof typeof PORTAL_LINKS
  variant: 'default' | 'outline'
}) {
  const intl = useIntl()
  const baseUrl = useBaseUrl()
  const [copying, setCopying] = useState(false)
  if (!baseUrl) return null
  const link = PORTAL_LINKS[page]
  return (
    <Button
      type="button"
      variant={variant}
      className="h-8"
      disabled={copying}
      onClick={async () => {
        setCopying(true)
        try {
          await copyWithFallback(new URL(link.path, baseUrl).toString())
          toast.success(intl.formatMessage(link.copied))
        } catch {
          toast.error(
            intl.formatMessage({
              id: 'onboarding.goalAction.copyFailed',
              defaultMessage: 'Could not copy the link. Try again.',
            })
          )
        } finally {
          setCopying(false)
        }
      }}
    >
      <ClipboardDocumentIcon aria-hidden="true" />
      <FormattedMessage {...link.label} />
    </Button>
  )
}

/**
 * The action beside the automatic first-win step, which ticks itself when a
 * customer acts: the way to reach one, again. Sharing the board for feedback,
 * the install page for Messenger, and the help center or status page link to
 * copy again.
 */
export function FirstWinShareAction({
  status,
  primary = false,
}: {
  status: LaunchStatus
  primary?: boolean
}): ReactNode {
  const variant = buildLaunchTasks(status).find((task) => task.id === 'first-win')?.variant
  const style = primary ? 'default' : 'outline'
  if (variant === 'feedback' || variant === 'private') {
    return <ShareBoardButton status={status} variant={style} />
  }
  if (variant === 'support') return <InstallMessengerLink variant={style} />
  if (variant === 'helpCenter') return <CopyPortalLinkButton page="helpCenter" variant={style} />
  if (variant === 'status') return <CopyPortalLinkButton page="status" variant={style} />
  return null
}

/** The launch plan page's first-win action, from the cached launch status. */
export function LaunchPlanFirstWinAction(): ReactNode {
  const { data: status } = useQuery(launchStatusQuery())
  return status ? <FirstWinShareAction status={status} /> : null
}
