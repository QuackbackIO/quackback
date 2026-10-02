import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ChatBubbleLeftRightIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import { GitHubIcon } from '@/components/icons/integration-icons'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge } from '@/components/shared/state-badge'
import { Switch } from '@/components/ui/switch'
import { settingsQueries } from '@/lib/client/queries/settings'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import { useUpdateConversationRouting } from '@/lib/client/mutations/channel-settings'
import { getChannelDescriptor } from '@/lib/shared/channels'
import {
  isPortalSupportSurfaceEnabled,
  isWidgetMessengerEnabled,
} from '@/lib/shared/support-surfaces'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

// The hub's GitHub row may be up to a minute old, like its email row.
const HUB_STATUS_STALE_MS = 60_000

export function ChannelsHubPage() {
  const settings = useWorkspaceSettings()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const widget = useSuspenseQuery(settingsQueries.widgetConfig())
  const portal = useSuspenseQuery(settingsQueries.portalConfig())
  const emailStatusQuery = useQuery(channelSettingsQueries.emailStatus())
  const githubStatusQuery = useQuery({
    ...githubChannelStatusQuery(),
    staleTime: HUB_STATUS_STALE_MS,
  })
  const routingQuery = useQuery(channelSettingsQueries.routing())
  const updateRouting = useUpdateConversationRouting()

  const enabled = updateRouting.isPending
    ? updateRouting.variables
    : (routingQuery.data?.enabled ?? false)
  const messenger = getChannelDescriptor('messenger')
  const email = getChannelDescriptor('email')
  const github = getChannelDescriptor('github')
  const messengerOn =
    isWidgetMessengerEnabled(flags, widget.data) ||
    isPortalSupportSurfaceEnabled(flags, portal.data)
  const emailSubtitle = emailStatusQuery.data?.inboundDomain ?? 'Add an inbound route'
  const githubStatus = githubStatusQuery.data
  const githubAttention =
    !!githubStatus?.connected &&
    (!!githubStatus.lastError ||
      githubStatus.status !== 'active' ||
      (githubStatus.inboxEnabled && !githubStatus.hasToken))
  const githubSubtitle =
    githubStatus?.connected && githubStatus.repo && (githubStatus.inboxEnabled || githubAttention)
      ? githubStatus.repo
      : 'Issues as conversations'

  return (
    <SettingsPage page="/admin/settings/channels">
      <SettingsCard flush>
        <SettingsList>
          <SettingsListRow
            to="/admin/settings/channels/messenger"
            leading={<RowIcon icon={ChatBubbleLeftRightIcon} />}
            title={messenger?.label ?? 'Messenger'}
            meta="Widget and portal"
            badges={messengerOn ? undefined : <StateBadge state="off" />}
          />
          <SettingsListRow
            to="/admin/settings/channels/email"
            leading={<RowIcon icon={EnvelopeIcon} />}
            title={email?.label ?? 'Email'}
            meta={emailSubtitle}
          />
          <SettingsListRow
            to="/admin/settings/channels/github"
            leading={<RowIcon icon={GitHubIcon} />}
            title={github?.label ?? 'GitHub'}
            meta={githubSubtitle}
            badges={githubAttention ? <StateBadge state="attention" /> : undefined}
          />
        </SettingsList>
      </SettingsCard>

      <SettingsCard
        title="Conversation routing"
        description="Applies to new conversations on every channel."
      >
        <SettingRows>
          <SettingRow
            label="Auto-assign new conversations"
            description="Assign to an agent who is online."
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
    </SettingsPage>
  )
}
