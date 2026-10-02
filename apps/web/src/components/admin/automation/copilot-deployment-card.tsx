import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { PauseIcon, PlayIcon } from '@heroicons/react/24/solid'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantCopilotCapabilities } from '@/lib/client/mutations/assistant'
import { isAssistantFieldManaged, ManagedSettingHint } from './assistant-form'
import { useAssistantSave } from './assistant-save-queue'

/**
 * Copilot's on/off master, driven by `agents.copilot.capabilities` rather than
 * a dedicated flag: Copilot is "on" when its Q&A capability is enabled.
 * Availability is the configured AI model: without one there is nowhere for
 * Copilot to run, so the control is hidden.
 */

/**
 * The quiet line under the Copilot title: whether teammates can use it.
 * Availability comes from the settings unless the caller overrides it.
 */
export function useCopilotStatusLine(availableOverride?: boolean) {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const available = availableOverride ?? settingsQuery.data?.aiAvailable !== false
  if (!available) {
    return intl.formatMessage({
      id: 'automation.copilot.deployment.unavailable',
      defaultMessage: 'Configure an AI model to let teammates use Copilot.',
    })
  }
  if (!settingsQuery.data) return undefined
  return settingsQuery.data.config.agents.copilot.capabilities.qa
    ? intl.formatMessage({
        id: 'automation.copilot.deployment.onLine',
        defaultMessage: 'Available to teammates in the inbox',
      })
    : intl.formatMessage({
        id: 'automation.copilot.deployment.pausedLine',
        defaultMessage: 'Paused, teammates do not see Copilot in the inbox',
      })
}

/** The header action that pauses or resumes Copilot for teammates. */
export function CopilotPauseControl({ available: availableOverride }: { available?: boolean }) {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const available = availableOverride ?? settingsQuery.data?.aiAvailable !== false
  const update = useUpdateAssistantCopilotCapabilities()
  const saveQueued = useAssistantSave()
  const [confirmingEnabled, setConfirmingEnabled] = useState<boolean | null>(null)

  const revision = settingsQuery.data?.revision
  const on = Boolean(settingsQuery.data?.config.agents.copilot.capabilities.qa)
  const capabilitiesManaged = isAssistantFieldManaged(
    settingsQuery.data?.managedFieldPaths ?? [],
    'agents.copilot.capabilities.qa'
  )

  async function confirmChange() {
    if (confirmingEnabled === null) return
    try {
      await saveQueued((latest) =>
        update.mutateAsync({
          expectedRevision: latest.revision,
          capabilities: { qa: confirmingEnabled },
        })
      )
    } catch {
      // The autosave handler shows the failure toast; the dialog stays open to retry.
      return
    }
    setConfirmingEnabled(null)
  }

  if (!available || revision === undefined) return null
  if (capabilitiesManaged) return <ManagedSettingHint />

  return (
    <>
      <Button
        type="button"
        variant={on ? 'outline' : 'default'}
        size="sm"
        disabled={update.isPending}
        onClick={() => setConfirmingEnabled(!on)}
      >
        {on ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        {on
          ? intl.formatMessage({
              id: 'automation.copilot.deployment.pause',
              defaultMessage: 'Pause Copilot',
            })
          : intl.formatMessage({
              id: 'automation.copilot.deployment.resume',
              defaultMessage: 'Resume',
            })}
      </Button>

      <ConfirmDialog
        open={confirmingEnabled !== null}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setConfirmingEnabled(null)
        }}
        title={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.copilot.deployment.resumeConfirmTitle',
                defaultMessage: 'Resume Copilot in the inbox?',
              })
            : intl.formatMessage({
                id: 'automation.copilot.deployment.pauseConfirmTitle',
                defaultMessage: 'Pause Copilot?',
              })
        }
        description={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.copilot.deployment.resumeConfirmDescription',
                defaultMessage:
                  'Teammates will be able to ask Copilot in the inbox and accept its drafted replies.',
              })
            : intl.formatMessage({
                id: 'automation.copilot.deployment.pauseConfirmDescription',
                defaultMessage:
                  'Copilot will stop answering teammates and offering drafts. Your configuration is kept.',
              })
        }
        confirmLabel={
          confirmingEnabled
            ? intl.formatMessage({
                id: 'automation.copilot.deployment.resume',
                defaultMessage: 'Resume',
              })
            : intl.formatMessage({
                id: 'automation.copilot.deployment.pause',
                defaultMessage: 'Pause Copilot',
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
