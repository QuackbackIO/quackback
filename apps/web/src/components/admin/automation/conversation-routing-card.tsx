/**
 * The workspace's auto-assign switch, on the Workflows page next to the
 * routing workflows it works alongside. It follows routing.manage (the
 * Support lead preset holds it), so a viewer without it sees no card and
 * reads nothing.
 */
import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateConversationRouting } from '@/lib/client/mutations/settings'
import { useHasPermission } from '@/lib/client/hooks/use-root-context'
import { PERMISSIONS } from '@/lib/shared/permissions'

export function ConversationRoutingCard() {
  const canManageRouting = useHasPermission(PERMISSIONS.ROUTING_MANAGE)
  if (!canManageRouting) return null
  return <ConversationRoutingSwitch />
}

function ConversationRoutingSwitch() {
  const intl = useIntl()
  const query = useQuery(settingsQueries.conversationRouting())
  const update = useUpdateConversationRouting()
  const enabled = update.isPending ? update.variables : (query.data?.enabled ?? false)

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.workflows.routingTitle',
        defaultMessage: 'Conversation routing',
      })}
    >
      <SettingRows>
        <SettingRow
          label={intl.formatMessage({
            id: 'automation.workflows.autoAssign',
            defaultMessage: 'Auto-assign new conversations',
          })}
          description={intl.formatMessage({
            id: 'automation.workflows.autoAssignHint',
            defaultMessage: 'Assign to an agent who is online, on every channel',
          })}
          htmlFor="routing-auto-assign"
          control={
            <Switch
              id="routing-auto-assign"
              checked={enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) => update.mutate(checked)}
            />
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
