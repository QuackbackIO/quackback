import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { PauseIcon, PlayIcon } from '@heroicons/react/24/solid'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { useUpdateWidgetAssistantDeployment } from '@/lib/client/mutations/assistant'
import { useHasPermission } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface WidgetAssistantDeployment {
  enabled: boolean
  respond: boolean
}

/**
 * The quiet line under the Agent title: where it replies, or why it does not.
 * The Agent answers in Messenger, which needs the Support inbox, so `available`
 * is the inbox flag. `ticketsOn` tells a tickets-only workspace apart from one
 * with Support off, because its Support switch already reads on.
 */
export function useAgentStatusLine(
  deployment: WidgetAssistantDeployment,
  available = true,
  ticketsOn = false
) {
  const intl = useIntl()
  if (!available) {
    return ticketsOn
      ? intl.formatMessage({
          id: 'automation.agent.deployment.unavailableTickets',
          defaultMessage:
            'Messenger replies need the Support inbox. Turn Support off and on again in Settings → General to add it.',
        })
      : intl.formatMessage({
          id: 'automation.agent.deployment.unavailable',
          defaultMessage:
            'Turn on Support in Settings → General to use automatic replies in Messenger.',
        })
  }
  return deployment.enabled && deployment.respond
    ? intl.formatMessage({
        id: 'automation.agent.deployment.liveLine',
        defaultMessage: 'Replying in Messenger',
      })
    : intl.formatMessage({
        id: 'automation.agent.deployment.pausedLine',
        defaultMessage: 'Paused, not replying in Messenger',
      })
}

/** The header action that pauses or resumes the Agent's automatic Messenger replies. */
export function AgentPauseControl({
  deployment,
  available = true,
  onChange,
}: {
  deployment: WidgetAssistantDeployment
  available?: boolean
  onChange: (deployment: WidgetAssistantDeployment) => void
}) {
  const intl = useIntl()
  const canOpenGeneral = useHasPermission(PERMISSIONS.SETTINGS_MANAGE)
  const updateDeployment = useUpdateWidgetAssistantDeployment()
  const [confirmingEnabled, setConfirmingEnabled] = useState<boolean | null>(null)
  const live = deployment.enabled && deployment.respond

  async function confirmChange() {
    if (confirmingEnabled === null) return
    const next = confirmingEnabled
      ? { enabled: true, respond: true }
      : { enabled: deployment.enabled, respond: false }
    try {
      await updateDeployment.mutateAsync(next)
    } catch {
      // The autosave handler shows the failure toast; the dialog stays open to retry.
      return
    }
    onChange(next)
    setConfirmingEnabled(null)
  }

  if (!available) {
    // General needs settings.manage; anyone else would only be sent to sign in.
    if (!canOpenGeneral) return null
    return (
      <Button type="button" variant="outline" size="sm" asChild>
        <Link to="/admin/settings/general">
          {intl.formatMessage({
            id: 'automation.agent.deployment.openGeneral',
            defaultMessage: 'Open product settings',
          })}
        </Link>
      </Button>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant={live ? 'outline' : 'default'}
        size="sm"
        disabled={updateDeployment.isPending}
        onClick={() => setConfirmingEnabled(!live)}
      >
        {live ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        {live
          ? intl.formatMessage({
              id: 'automation.agent.deployment.pause',
              defaultMessage: 'Pause Agent',
            })
          : intl.formatMessage({
              id: 'automation.agent.deployment.resume',
              defaultMessage: 'Resume',
            })}
      </Button>

      <ConfirmDialog
        open={confirmingEnabled !== null}
        onOpenChange={(open) => {
          if (!open && !updateDeployment.isPending) setConfirmingEnabled(null)
        }}
        title={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.agent.deployment.enableConfirmTitle',
                defaultMessage: 'Resume the Agent in Messenger?',
              })
            : intl.formatMessage({
                id: 'automation.agent.deployment.pauseConfirmTitle',
                defaultMessage: 'Pause the Agent in Messenger?',
              })
        }
        description={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.agent.deployment.enableConfirmDescription',
                defaultMessage:
                  'The AI agent will start answering new customer messages in Messenger using your saved settings.',
              })
            : intl.formatMessage({
                id: 'automation.agent.deployment.pauseConfirmDescription',
                defaultMessage:
                  'The AI agent will stop answering new customer messages automatically.',
              })
        }
        confirmLabel={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.agent.deployment.enableConfirm',
                defaultMessage: 'Resume',
              })
            : intl.formatMessage({
                id: 'automation.agent.deployment.pause',
                defaultMessage: 'Pause Agent',
              })
        }
        cancelLabel={intl.formatMessage({
          id: 'automation.common.cancel',
          defaultMessage: 'Cancel',
        })}
        isPending={updateDeployment.isPending}
        onConfirm={confirmChange}
      />
    </>
  )
}
