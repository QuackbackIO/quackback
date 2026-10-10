import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ActivationActionButton,
  copyWithFallback,
} from '@/components/admin/activation-action-button'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import { markStatusLinkCopiedFn } from '@/lib/server/functions/activation'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { launchOutcome, type LaunchStatus, type LaunchTask } from '@/lib/shared/launch-checklist'
import { openGoingLiveSheet } from './going-live-events'

// The editor loads when the step opens it, not with every page that lists the step.
const CreateArticleDialog = lazy(() =>
  import('@/components/admin/help-center/create-article-dialog').then((module) => ({
    default: module.CreateArticleDialog,
  }))
)

/**
 * Opens the article editor in place: setup seeded a category, so the first
 * article saves. Publishing keeps the person where they are, says so, and
 * lets the plan move on to its next step there.
 */
function WriteArticleButton({ variant }: { variant: 'default' | 'outline' }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <FormattedMessage id="onboarding.launch.writeArticle" defaultMessage="Write article" />
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <CreateArticleDialog
            open
            onOpenChange={setOpen}
            onPublished={() => {
              toast.success(
                intl.formatMessage({
                  id: 'onboarding.launch.articlePublished',
                  defaultMessage: 'Article published',
                })
              )
              void queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] })
              // The article is real data: Home's counts catch up too.
              void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] })
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}

/** The status page's public address on the portal. */
export function statusPageUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null
  return new URL('/status', baseUrl).toString()
}

/** Copies the status page link and records it, which completes the status goal's step. */
function CopyStatusLinkButton({ variant }: { variant: 'default' | 'outline' }) {
  const intl = useIntl()
  const baseUrl = useBaseUrl()
  const queryClient = useQueryClient()
  const [copying, setCopying] = useState(false)
  const url = statusPageUrl(baseUrl)
  if (!url) return null
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={copying}
      onClick={async () => {
        setCopying(true)
        try {
          await copyWithFallback(url)
          await markStatusLinkCopiedFn()
          await queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] })
          toast.success(
            intl.formatMessage({
              id: 'onboarding.launch.statusLinkCopied',
              defaultMessage: 'Status page link copied',
            })
          )
        } catch {
          toast.error(
            intl.formatMessage({
              id: 'onboarding.launch.copyFailed',
              defaultMessage: 'Could not copy the link. Try again.',
            })
          )
        } finally {
          setCopying(false)
        }
      }}
    >
      <FormattedMessage id="onboarding.launch.copyStatusLink" defaultMessage="Copy status link" />
    </Button>
  )
}

/**
 * The one action a launch step offers: copy the board or status link, create
 * the board, open the sheet that does the step in place, or open the page that
 * does it. The automatic first win takes its action from the caller. Null for
 * a step that is done, skipped or blocked.
 */
export function LaunchStepAction({
  task,
  status,
  primary,
  pending = false,
  firstWinAction,
  onCreateBoard,
}: {
  task: LaunchTask
  status: LaunchStatus
  primary: boolean
  pending?: boolean
  firstWinAction?: ReactNode
  onCreateBoard: () => void
}): ReactNode {
  if (task.isCompleted || task.isSkipped || task.availability === 'blocked') return null
  if (task.classification === 'first_win') return firstWinAction ?? null
  const variant = primary ? 'default' : 'outline'
  const copy =
    task.id === 'distribute-feedback' ? copyBoardLinkAction(launchOutcome(status), status) : null
  if (copy) {
    return (
      <ActivationActionButton
        action={copy}
        surface="launch_plan"
        variant={variant}
        className="h-8"
      />
    )
  }
  if (task.id === 'share-status-page') return <CopyStatusLinkButton variant={variant} />
  if (task.id === 'help-article') return <WriteArticleButton variant={variant} />
  if (task.id === 'create-board') {
    return (
      <Button size="sm" variant={variant} disabled={pending} onClick={onCreateBoard}>
        <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
      </Button>
    )
  }
  if (task.sheet) {
    const sheet = task.sheet
    return (
      <Button size="sm" variant={variant} onClick={() => openGoingLiveSheet(sheet)}>
        <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
      </Button>
    )
  }
  if (!task.href) return null
  return (
    <Button asChild size="sm" variant={variant}>
      <Link to={task.href} search={task.search as never}>
        <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
      </Link>
    </Button>
  )
}
