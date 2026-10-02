/**
 * Abandoned-journey auto-close (support platform, abandoned-journey
 * auto-close spec): a workspace-wide setting governing every customer-facing
 * workflow's interactive blocks (reply buttons, collect data/reply, a rating
 * ask). When a visitor never answers one, the sweeper ends the stalled run
 * and — unless a human is already engaged or a contact email was captured —
 * closes the conversation so it doesn't sit open forever with nobody coming
 * back. One control here governs every workflow's interactive blocks, so it
 * lives on the Workflows page itself rather than inside any single
 * workflow's builder.
 */
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  useUpdateWorkflowAbandonedAutoClose,
  useUpdateWorkflowCloseSpam,
} from '@/lib/client/mutations/settings'
import { ClampedIntInput } from './workflow-builder/inspector/shared'
import {
  DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE,
  type WorkflowAbandonedAutoCloseSettings,
} from '@/lib/shared/workflows/abandoned-auto-close'
import { DEFAULT_WORKFLOW_CLOSE_SPAM } from '@/lib/shared/workflows/close-spam'

export function AbandonedJourneyAutoCloseCard() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const query = useQuery(settingsQueries.workflowAbandonedAutoClose())
  const closeSpamQuery = useQuery(settingsQueries.workflowCloseSpam())
  const update = useUpdateWorkflowAbandonedAutoClose()
  const updateCloseSpam = useUpdateWorkflowCloseSpam()
  // Instant feedback while a save is in flight, same idiom as the office
  // hours page and AssistantBasicsCard: the control reflects the optimistic
  // value immediately and falls back to the last-saved one on failure.
  const [override, setOverride] = useState<WorkflowAbandonedAutoCloseSettings | null>(null)

  const saved = query.data ?? DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE
  const settings = override ?? saved

  function save(next: WorkflowAbandonedAutoCloseSettings) {
    setOverride(next)
    update.mutate(next, {
      onSuccess: (result) => {
        queryClient.setQueryData(settingsQueries.workflowAbandonedAutoClose().queryKey, result)
        setOverride(null)
      },
      onError: () => setOverride(null),
    })
  }

  const isBusy = update.isPending
  const closeSpamEnabled = closeSpamQuery.data?.enabled ?? DEFAULT_WORKFLOW_CLOSE_SPAM.enabled

  return (
    <SettingsCard
      title="Abandoned journeys"
      description="Close conversations whose interactive step went unanswered."
    >
      <SettingRows>
        <SettingRow
          label="Auto-close abandoned journeys"
          description="Ends a run when an interactive step stalls"
          htmlFor="abandoned-auto-close-enabled"
          control={
            <Switch
              id="abandoned-auto-close-enabled"
              checked={settings.enabled}
              onCheckedChange={(checked) => save({ ...settings, enabled: checked })}
              disabled={isBusy}
            />
          }
        />

        {settings.enabled && (
          <>
            <SettingRow
              label="Wait before closing"
              description="How long a step waits for a reply before it counts as abandoned"
              htmlFor="abandoned-auto-close-wait"
              control={
                <>
                  <ClampedIntInput
                    value={settings.waitMinutes}
                    min={1}
                    max={60}
                    onCommit={(waitMinutes) => save({ ...settings, waitMinutes })}
                    className="h-8 w-20 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">minutes</span>
                </>
              }
            />

            <SettingRow
              label="Keep open if an email was captured"
              description="Leaves the conversation open for follow-up when there is a contact email"
              htmlFor="abandoned-auto-close-keep-email"
              control={
                <Switch
                  id="abandoned-auto-close-keep-email"
                  checked={settings.keepIfEmailCaptured}
                  onCheckedChange={(checked) => save({ ...settings, keepIfEmailCaptured: checked })}
                  disabled={isBusy}
                />
              }
            />
          </>
        )}

        <SettingRow
          label={intl.formatMessage({
            id: 'automation.workflows.closeSpam',
            defaultMessage: 'Close spam',
          })}
          description={intl.formatMessage({
            id: 'automation.workflows.closeSpamHint',
            defaultMessage: 'When Quinn classifies a conversation as spam',
          })}
          htmlFor="close-spam-enabled"
          control={
            <Switch
              id="close-spam-enabled"
              checked={closeSpamEnabled}
              onCheckedChange={(checked) => updateCloseSpam.mutate({ enabled: checked })}
              disabled={updateCloseSpam.isPending}
            />
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
