import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChatBubbleLeftRightIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import { GitHubIcon } from '@/components/icons/integration-icons'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsMenuCard, SettingsMenuRow } from '@/components/admin/settings/settings-menu-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { settingsQueries } from '@/lib/client/queries/settings'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import { updateConversationRoutingFn } from '@/lib/server/functions/settings'
import { useQuery } from '@tanstack/react-query'
import { getChannelDescriptor } from '@/lib/shared/channels'
import {
  isPortalSupportSurfaceEnabled,
  isWidgetMessengerEnabled,
} from '@/lib/shared/support-surfaces'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

// The hub's GitHub row may be up to a minute old, like its email row.
const HUB_STATUS_STALE_MS = 60_000

export const Route = createFileRoute('/admin/settings/channels')({
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const { queryClient } = context
    const [{ channelSettingsQueries: channels }, { githubChannelStatusQuery: githubStatus }] =
      await Promise.all([
        import('@/lib/client/queries/channel-settings'),
        import('@/integrations/github/ui/github-channel-status-query'),
      ])
    // The status rows and the routing switch are warmed with the configs so
    // the hub renders complete from the document. A miss leaves a row to its
    // own fetch and its defaults, as before.
    const ensure = readBatch(queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(settingsQueries.portalConfig()),
      warmQuery(ensure, channels.emailStatus()),
      warmQuery(ensure, githubStatus()),
      warmQuery(ensure, channels.routing()),
    ])
    return {}
  },
  component: ChannelsHubPage,
})

function ChannelsHubPage() {
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
  const [routingEnabled, setRoutingEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const enabled = routingEnabled ?? routingQuery.data?.enabled ?? false
  const messenger = getChannelDescriptor('messenger')
  const email = getChannelDescriptor('email')
  const github = getChannelDescriptor('github')
  const messengerOn =
    isWidgetMessengerEnabled(flags, widget.data) ||
    isPortalSupportSurfaceEnabled(flags, portal.data)
  const receiving = emailStatusQuery.data?.inboundConfigured === true
  const sendingOnly = !receiving && !!emailStatusQuery.data?.fromAddress
  const emailStatus = receiving ? 'Receiving' : sendingOnly ? 'Sending only' : 'Set up'
  const emailSubtitle = emailStatusQuery.data?.inboundDomain ?? 'Add an inbound route'
  const githubStatus = githubStatusQuery.data
  const githubAttention =
    !!githubStatus?.connected &&
    (!!githubStatus.lastError ||
      githubStatus.status !== 'active' ||
      (githubStatus.inboxEnabled && !githubStatus.hasToken))
  const githubBadge = !githubStatus?.connected
    ? { label: 'Set up', variant: 'secondary' as const }
    : githubAttention
      ? { label: 'Attention', variant: 'destructive' as const }
      : githubStatus.inboxEnabled
        ? { label: 'On', variant: 'default' as const }
        : { label: 'Off', variant: 'secondary' as const }
  const githubSubtitle =
    githubStatus?.connected && githubStatus.repo && (githubStatus.inboxEnabled || githubAttention)
      ? githubStatus.repo
      : 'Issues as conversations'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings/support">Support</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Channels"
        description="Where customer conversations happen."
      />

      <SettingsMenuCard>
        <SettingsMenuRow
          to="/admin/settings/channels/messenger"
          icon={ChatBubbleLeftRightIcon}
          title={messenger?.label ?? 'Messenger'}
          description="Widget and portal"
          trailing={
            <Badge size="sm" shape="pill" variant={messengerOn ? 'default' : 'secondary'}>
              {messengerOn ? 'On' : 'Off'}
            </Badge>
          }
        />
        <SettingsMenuRow
          to="/admin/settings/channels/email"
          icon={EnvelopeIcon}
          title={email?.label ?? 'Email'}
          description={emailSubtitle}
          trailing={
            <Badge
              size="sm"
              shape="pill"
              variant={emailStatus === 'Set up' ? 'secondary' : 'default'}
            >
              {emailStatus}
            </Badge>
          }
        />
        <SettingsMenuRow
          to="/admin/settings/channels/github"
          icon={GitHubIcon}
          title={github?.label ?? 'GitHub'}
          description={githubSubtitle}
          trailing={
            <Badge size="sm" shape="pill" variant={githubBadge.variant}>
              {githubBadge.label}
            </Badge>
          }
        />
      </SettingsMenuCard>

      <SettingsCard
        title="Conversation routing"
        description="Applies to new conversations on every channel."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="routing-auto-assign" className="text-sm font-medium cursor-pointer">
              Auto-assign new conversations
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Assign each new conversation to an agent who is currently online. When no one is
              available, it stays unassigned.
            </p>
          </div>
          <Switch
            id="routing-auto-assign"
            checked={enabled}
            disabled={saving || routingQuery.isLoading}
            onCheckedChange={async (checked) => {
              setRoutingEnabled(checked)
              setSaving(true)
              try {
                await updateConversationRoutingFn({
                  data: { enabled: checked, strategy: 'auto_assign_active' },
                })
              } catch {
                setRoutingEnabled(!checked)
              } finally {
                setSaving(false)
              }
            }}
          />
        </div>
      </SettingsCard>
    </div>
  )
}
