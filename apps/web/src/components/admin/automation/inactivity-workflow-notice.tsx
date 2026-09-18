import { useQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateConversationInactivity } from '@/lib/client/mutations/settings'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { inactivityWorkflowChannels } from '@/lib/shared/conversation-inactivity'
import { Button } from '@/components/ui/button'

/** Publishing is independent of ownership; switching is an explicit action. */
export function InactivityWorkflowNotice({
  triggerSettings,
}: {
  triggerSettings: Record<string, unknown>
}) {
  const query = useQuery(settingsQueries.conversationInactivity())
  const update = useUpdateConversationInactivity()
  const canMessenger = usePermission(PERMISSIONS.SETTINGS_MANAGE)
  const canEmail = usePermission(PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)
  const channels = inactivityWorkflowChannels(triggerSettings)
  if (!query.data)
    return (
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {query.isError
          ? 'Could not load channel inactivity ownership.'
          : 'Loading channel inactivity ownership…'}
      </p>
    )
  return (
    <div className="border-b bg-muted/30 px-4 py-3 space-y-2 text-xs">
      <p>
        Publishing does not change inactivity handling. Use custom workflows for the channels this
        workflow should control.
      </p>
      <div className="flex flex-wrap gap-4">
        {channels.map((channel) => (
          <div key={channel} className="flex items-center gap-2">
            <span>
              {channel === 'email' ? 'Email' : 'Messenger'}:{' '}
              {
                { built_in: 'Built-in rules', custom: 'Custom workflows', off: 'Off' }[
                  query.data?.channels?.[channel] ?? 'built_in'
                ]
              }
            </span>
            {query.data?.channels?.[channel] !== 'custom' && (
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending || !(channel === 'email' ? canEmail : canMessenger)}
                onClick={() =>
                  update.mutate({
                    section: channel,
                    revision: query.data?.revision ?? 0,
                    policy: {},
                    mode: 'custom',
                  })
                }
              >
                Use custom workflows
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground">
        Audience filters still apply. Conversations outside those filters have no automatic
        fallback.
      </p>
      {update.isError && (
        <p role="alert" className="text-destructive">
          {update.error.message}
        </p>
      )}
    </div>
  )
}
