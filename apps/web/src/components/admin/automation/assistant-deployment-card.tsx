import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUpdateWidgetAssistantDeployment } from '@/lib/client/mutations/assistant'

export interface WidgetAssistantDeployment {
  enabled: boolean
  respond: boolean
}

export function AssistantDeploymentCard({
  deployment,
  available = true,
  onChange,
}: {
  deployment: WidgetAssistantDeployment
  available?: boolean
  onChange: (deployment: WidgetAssistantDeployment) => void
}) {
  const intl = useIntl()
  const updateDeployment = useUpdateWidgetAssistantDeployment()
  const [confirmingEnabled, setConfirmingEnabled] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const live = deployment.enabled && deployment.respond

  async function confirmChange() {
    if (confirmingEnabled === null) return
    const next = confirmingEnabled
      ? { enabled: true, respond: true }
      : { enabled: deployment.enabled, respond: false }
    try {
      setMessage('')
      await updateDeployment.mutateAsync(next)
      onChange(next)
      setMessage(
        next.respond
          ? intl.formatMessage({
              id: 'automation.agent.deployment.enabledStatus',
              defaultMessage: 'Automatic replies are enabled in Messenger.',
            })
          : intl.formatMessage({
              id: 'automation.agent.deployment.pausedStatus',
              defaultMessage: 'Automatic replies are paused.',
            })
      )
      setConfirmingEnabled(null)
    } catch {
      setMessage(
        intl.formatMessage({
          id: 'automation.agent.deployment.error',
          defaultMessage: 'The deployment setting could not be changed. Try again.',
        })
      )
    }
  }

  return (
    <>
      <section
        aria-labelledby="assistant-deployment-heading"
        className="rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4"
      >
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="assistant-deployment-heading" className="text-sm font-medium">
                {intl.formatMessage({
                  id: 'automation.agent.deployment.channelHeading',
                  defaultMessage: 'Messenger replies',
                })}
              </h2>
              <Badge variant={!available ? 'outline' : live ? 'default' : 'secondary'} shape="pill">
                {!available
                  ? intl.formatMessage({
                      id: 'automation.agent.status.unavailable',
                      defaultMessage: 'Unavailable',
                    })
                  : live
                    ? intl.formatMessage({
                        id: 'automation.agent.status.on',
                        defaultMessage: 'On',
                      })
                    : intl.formatMessage({
                        id: 'automation.agent.status.paused',
                        defaultMessage: 'Paused',
                      })}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {!available
                ? intl.formatMessage({
                    id: 'automation.agent.deployment.unavailable',
                    defaultMessage:
                      'Enable the support inbox to use automatic replies in Messenger.',
                  })
                : live
                  ? intl.formatMessage({
                      id: 'automation.agent.deployment.liveHelp',
                      defaultMessage: 'Saved settings affect new AI agent replies.',
                    })
                  : intl.formatMessage({
                      id: 'automation.agent.deployment.pausedHelp',
                      defaultMessage:
                        'You can keep editing and testing without sending AI replies to customers.',
                    })}
            </p>
          </div>
          {available ? (
            <Button
              type="button"
              variant={live ? 'outline' : 'default'}
              className="min-h-11 w-full sm:min-h-9 sm:w-auto"
              disabled={updateDeployment.isPending}
              onClick={() => setConfirmingEnabled(!live)}
            >
              {live
                ? intl.formatMessage({
                    id: 'automation.agent.deployment.pause',
                    defaultMessage: 'Pause automatic replies',
                  })
                : intl.formatMessage({
                    id: 'automation.agent.deployment.enable',
                    defaultMessage: 'Enable automatic replies',
                  })}
            </Button>
          ) : null}
        </div>
        {message && (
          <p
            role={message.includes('could not') ? 'alert' : 'status'}
            aria-live="polite"
            className={
              message.includes('could not')
                ? 'mt-3 text-xs text-destructive'
                : 'mt-3 text-xs text-muted-foreground'
            }
          >
            {message}
          </p>
        )}
      </section>

      <ConfirmDialog
        open={confirmingEnabled !== null}
        onOpenChange={(open) => {
          if (!open && !updateDeployment.isPending) setConfirmingEnabled(null)
        }}
        title={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.agent.deployment.enableConfirmTitle',
                defaultMessage: 'Enable automatic replies in Messenger?',
              })
            : intl.formatMessage({
                id: 'automation.agent.deployment.pauseConfirmTitle',
                defaultMessage: 'Pause automatic replies in Messenger?',
              })
        }
        description={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.agent.deployment.enableConfirmDescription',
                defaultMessage:
                  'The AI agent will begin answering customers using your saved settings. Test the agent before enabling it.',
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
                defaultMessage: 'Enable replies',
              })
            : intl.formatMessage({
                id: 'automation.agent.deployment.pauseConfirm',
                defaultMessage: 'Pause replies',
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
