import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantCopilotCapabilities } from '@/lib/client/mutations/assistant'
import { isAssistantFieldManaged, ManagedSettingHint } from './assistant-form'

/**
 * Copilot's on/off master, driven by `agents.copilot.capabilities` rather than
 * a dedicated flag: Copilot is "on" when its Q&A capability is enabled. The
 * `inboxAi` flag stays the availability gate — when it is off there is nowhere
 * for Copilot to run, so the toggle is hidden entirely.
 */
export function CopilotDeploymentCard({ available = true }: { available?: boolean }) {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const update = useUpdateAssistantCopilotCapabilities()
  const [confirmingEnabled, setConfirmingEnabled] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')

  const capabilities = settingsQuery.data?.config.agents.copilot.capabilities
  const revision = settingsQuery.data?.revision
  const on = Boolean(capabilities?.qa)
  const managedPaths = settingsQuery.data?.managedFieldPaths ?? []
  const capabilitiesManaged = isAssistantFieldManaged(
    managedPaths,
    'agents.copilot.capabilities.qa'
  )

  async function confirmChange() {
    if (confirmingEnabled === null || revision === undefined) return
    const next = { qa: confirmingEnabled }
    try {
      setMessage('')
      await update.mutateAsync({ expectedRevision: revision, capabilities: next })
      setMessage(
        confirmingEnabled
          ? intl.formatMessage({
              id: 'automation.copilot.deployment.enabledStatus',
              defaultMessage: 'Copilot is on in the inbox.',
            })
          : intl.formatMessage({
              id: 'automation.copilot.deployment.pausedStatus',
              defaultMessage: 'Copilot is off.',
            })
      )
      setConfirmingEnabled(null)
    } catch {
      setMessage(
        intl.formatMessage({
          id: 'automation.copilot.deployment.error',
          defaultMessage: 'Copilot could not be changed. Try again.',
        })
      )
    }
  }

  return (
    <>
      <section
        aria-labelledby="copilot-deployment-heading"
        className="rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4"
      >
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="copilot-deployment-heading" className="text-sm font-medium">
                {intl.formatMessage({
                  id: 'automation.copilot.deployment.heading',
                  defaultMessage: 'Copilot in the inbox',
                })}
              </h2>
              <Badge variant={!available ? 'outline' : on ? 'default' : 'secondary'} shape="pill">
                {!available
                  ? intl.formatMessage({
                      id: 'automation.agent.status.unavailable',
                      defaultMessage: 'Unavailable',
                    })
                  : on
                    ? intl.formatMessage({ id: 'automation.agent.status.on', defaultMessage: 'On' })
                    : intl.formatMessage({
                        id: 'automation.copilot.status.off',
                        defaultMessage: 'Off',
                      })}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {!available
                ? intl.formatMessage({
                    id: 'automation.copilot.deployment.unavailable',
                    defaultMessage: 'Enable AI in the inbox to let teammates use Copilot.',
                  })
                : on
                  ? intl.formatMessage({
                      id: 'automation.copilot.deployment.onHelp',
                      defaultMessage: 'Teammates can ask Copilot and accept its drafts.',
                    })
                  : intl.formatMessage({
                      id: 'automation.copilot.deployment.offHelp',
                      defaultMessage:
                        'You can keep configuring Copilot without teammates seeing it in the inbox.',
                    })}
            </p>
          </div>
          {available && revision !== undefined && capabilitiesManaged ? (
            <ManagedSettingHint />
          ) : available && revision !== undefined ? (
            <Button
              type="button"
              variant={on ? 'outline' : 'default'}
              className="min-h-11 w-full sm:min-h-9 sm:w-auto"
              disabled={update.isPending}
              onClick={() => setConfirmingEnabled(!on)}
            >
              {on
                ? intl.formatMessage({
                    id: 'automation.copilot.deployment.turnOff',
                    defaultMessage: 'Turn off Copilot',
                  })
                : intl.formatMessage({
                    id: 'automation.copilot.deployment.turnOn',
                    defaultMessage: 'Turn on Copilot',
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
          if (!open && !update.isPending) setConfirmingEnabled(null)
        }}
        title={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.copilot.deployment.turnOnConfirmTitle',
                defaultMessage: 'Turn on Copilot in the inbox?',
              })
            : intl.formatMessage({
                id: 'automation.copilot.deployment.turnOffConfirmTitle',
                defaultMessage: 'Turn off Copilot?',
              })
        }
        description={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.copilot.deployment.turnOnConfirmDescription',
                defaultMessage:
                  'Teammates will be able to ask Copilot in the inbox and accept its drafted replies.',
              })
            : intl.formatMessage({
                id: 'automation.copilot.deployment.turnOffConfirmDescription',
                defaultMessage:
                  'Copilot will stop answering teammates and offering drafts. Your configuration is kept.',
              })
        }
        confirmLabel={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.copilot.deployment.turnOn',
                defaultMessage: 'Turn on Copilot',
              })
            : intl.formatMessage({
                id: 'automation.copilot.deployment.turnOff',
                defaultMessage: 'Turn off Copilot',
              })
        }
        cancelLabel={intl.formatMessage({
          id: 'automation.common.cancel',
          defaultMessage: 'Cancel',
        })}
        isPending={update.isPending}
        onConfirm={confirmChange}
      />
    </>
  )
}
