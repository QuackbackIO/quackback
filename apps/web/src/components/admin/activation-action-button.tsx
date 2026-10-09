import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { defineMessages, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { markPublicBoardLinkCopiedFn } from '@/lib/server/functions/activation'
import type { ActivationAction, ActivationSurface } from '@/lib/shared/activation-action'
import { recordPlgEvent } from '@/lib/client/plg-events'

export async function copyWithFallback(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Clipboard permissions are commonly denied in embedded/admin contexts.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Copy failed')
}

const actionLabels = defineMessages({
  'copy-board-link': { id: 'activation.action.copyBoardLink', defaultMessage: 'Copy board link' },
  'invite-teammate': {
    id: 'activation.action.inviteTeammate',
    defaultMessage: 'Invite a teammate',
  },
  'create-feedback-board': {
    id: 'activation.action.createFeedbackBoard',
    defaultMessage: 'Create feedback board',
  },
  'connect-messenger': {
    id: 'activation.action.connectMessenger',
    defaultMessage: 'Connect Messenger',
  },
  'open-installed-site': { id: 'activation.action.openSite', defaultMessage: 'Open your site' },
  'open-launch-plan': { id: 'activation.action.openHome', defaultMessage: 'Open Home' },
  'open-feedback-board': { id: 'activation.action.openBoard', defaultMessage: 'Open your board' },
  'continue-help-article': {
    id: 'activation.action.continueArticle',
    defaultMessage: 'Continue the article',
  },
  'open-workspace': {
    id: 'activation.action.openWorkspace',
    defaultMessage: 'Go to your workspace',
  },
})

/** An action's label in the viewer's language; its own label for an action this list lacks. */
export function useActivationActionLabel(action: ActivationAction): string {
  const intl = useIntl()
  const message = actionLabels[action.id as keyof typeof actionLabels]
  return message ? intl.formatMessage(message) : action.label
}

export function ActivationActionButton({
  action,
  surface,
  variant = 'default',
  className,
  onCompleted,
}: {
  action: ActivationAction
  surface: ActivationSurface
  variant?: 'default' | 'outline' | 'ghost'
  className?: string
  onCompleted?: () => void | Promise<void>
}) {
  const intl = useIntl()
  const label = useActivationActionLabel(action)
  const queryClient = useQueryClient()
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    recordPlgEvent({
      name: 'activation_cta_viewed',
      outcome: action.outcome,
      surface,
      actionId: action.id,
    })
  }, [action.id, action.outcome, surface])

  const recordClick = () =>
    recordPlgEvent({
      name: 'activation_cta_clicked',
      outcome: action.outcome,
      surface,
      actionId: action.id,
    })

  if (action.kind === 'copy') {
    return (
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={copying}
        onClick={async () => {
          recordClick()
          setCopying(true)
          try {
            const url = new URL(action.payload.path, window.location.origin).toString()
            await copyWithFallback(url)
            await markPublicBoardLinkCopiedFn({ data: { boardId: action.payload.boardId } })
            await queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] })
            await onCompleted?.()
            toast.success(
              intl.formatMessage({
                id: 'activation.boardLinkCopied',
                defaultMessage: 'Board link copied',
              })
            )
          } catch {
            toast.error(
              intl.formatMessage({
                id: 'activation.boardLinkCopyFailed',
                defaultMessage:
                  'Couldn’t copy the board link. Open the board and copy it from your browser.',
              })
            )
          } finally {
            setCopying(false)
          }
        }}
      >
        <ClipboardDocumentIcon className="h-4 w-4" />
        {copying
          ? intl.formatMessage({ id: 'activation.copying', defaultMessage: 'Copying…' })
          : label}
      </Button>
    )
  }

  return (
    <Button asChild variant={variant} className={className}>
      <a
        href={action.destination}
        {...(action.kind === 'external' ? { target: '_blank', rel: 'noreferrer' } : {})}
        onClick={() => {
          recordClick()
          void onCompleted?.()
        }}
      >
        {label}
        {action.kind === 'external' && <ArrowTopRightOnSquareIcon className="h-4 w-4" />}
      </a>
    </Button>
  )
}
