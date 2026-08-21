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
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
      description="Close conversations whose interactive step (buttons, a question, a rating ask) went unanswered."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label
              htmlFor="abandoned-auto-close-enabled"
              className="text-sm font-medium cursor-pointer"
            >
              Auto-close abandoned journeys
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Off by default. When on, a stalled interactive step ends its run after the wait below.
            </p>
          </div>
          <Switch
            id="abandoned-auto-close-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => save({ ...settings, enabled: checked })}
            disabled={isBusy}
          />
        </div>

        {settings.enabled && (
          <>
            <div className="flex items-center justify-between py-1">
              <div className="pr-4">
                <Label htmlFor="abandoned-auto-close-wait" className="text-sm font-medium">
                  Wait before closing
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How long an interactive step waits for a reply before it's considered abandoned.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <ClampedIntInput
                  value={settings.waitMinutes}
                  min={1}
                  max={60}
                  onCommit={(waitMinutes) => save({ ...settings, waitMinutes })}
                  className="h-8 w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <div className="pr-4">
                <Label
                  htmlFor="abandoned-auto-close-keep-email"
                  className="text-sm font-medium cursor-pointer"
                >
                  Keep open if an email was captured
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Leave the conversation open for a human follow-up when there's a contact email to
                  reach, even though the journey itself stalled.
                </p>
              </div>
              <Switch
                id="abandoned-auto-close-keep-email"
                checked={settings.keepIfEmailCaptured}
                onCheckedChange={(checked) => save({ ...settings, keepIfEmailCaptured: checked })}
                disabled={isBusy}
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="close-spam-enabled" className="text-sm font-medium cursor-pointer">
              {intl.formatMessage({
                id: 'automation.workflows.closeSpam',
                defaultMessage: 'Close spam',
              })}
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.workflows.closeSpamHint',
                defaultMessage: 'When Quinn classifies a conversation as spam',
              })}
            </p>
          </div>
          <Switch
            id="close-spam-enabled"
            checked={closeSpamEnabled}
            onCheckedChange={(checked) => updateCloseSpam.mutate({ enabled: checked })}
            disabled={updateCloseSpam.isPending}
          />
        </div>
      </div>
    </SettingsCard>
  )
}
