import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { useUpdateConversationRouting } from '@/lib/client/mutations/channel-settings'

/** Whether new conversations on every channel are assigned to a teammate who is online. */
export function ConversationRoutingCard() {
  const intl = useIntl()
  const routingQuery = useQuery(channelSettingsQueries.routing())
  const updateRouting = useUpdateConversationRouting()

  const enabled = updateRouting.isPending
    ? updateRouting.variables
    : (routingQuery.data?.enabled ?? false)

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'support.routing.title',
        defaultMessage: 'Conversation routing',
      })}
      description={intl.formatMessage({
        id: 'support.routing.description',
        defaultMessage: 'Applies to new conversations on every channel.',
      })}
    >
      <SettingRows>
        <SettingRow
          label={intl.formatMessage({
            id: 'support.routing.autoAssign',
            defaultMessage: 'Auto-assign new conversations',
          })}
          description={intl.formatMessage({
            id: 'support.routing.online',
            defaultMessage: 'Assign to a teammate who is online.',
          })}
          htmlFor="routing-auto-assign"
          control={
            <Switch
              id="routing-auto-assign"
              checked={enabled}
              disabled={routingQuery.isLoading}
              onCheckedChange={(checked) => updateRouting.mutate(checked)}
            />
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
