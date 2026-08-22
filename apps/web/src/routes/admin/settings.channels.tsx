import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChatBubbleLeftRightIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  fetchConversationRoutingFn,
  getEmailChannelStatusFn,
  updateConversationRoutingFn,
} from '@/lib/server/functions/settings'
import { useQuery } from '@tanstack/react-query'
import { getChannelDescriptor } from '@/lib/shared/channels'

export const Route = createFileRoute('/admin/settings/channels')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: ChannelsHubRoute,
})

function ChannelsHubRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) return <Navigate to="/admin/settings" />
  return <ChannelsHubPage />
}

function ChannelsHubPage() {
  const widget = useSuspenseQuery(settingsQueries.widgetConfig())
  const portal = useSuspenseQuery(settingsQueries.portalConfig())
  const emailStatusQuery = useQuery({
    queryKey: ['settings', 'email-channel-status'],
    queryFn: () => getEmailChannelStatusFn(),
    staleTime: 60_000,
  })
  const routingQuery = useQuery({
    queryKey: ['conversation-routing'],
    queryFn: () => fetchConversationRoutingFn(),
  })
  const [routingEnabled, setRoutingEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const enabled = routingEnabled ?? routingQuery.data?.enabled ?? false
  const messenger = getChannelDescriptor('messenger')
  const email = getChannelDescriptor('email')
  const messengerOn = widget.data.tabs?.messenger === true || portal.data?.support?.enabled === true
  const receiving = emailStatusQuery.data?.inboundConfigured === true
  const sendingOnly = !receiving && !!emailStatusQuery.data?.fromAddress
  const emailStatus = receiving ? 'Receiving' : sendingOnly ? 'Sending only' : 'Set up'
  const emailSubtitle = emailStatusQuery.data?.inboundDomain ?? 'Add an inbound route'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Channels"
        description="Where customer conversations happen."
      />

      <div className="divide-y divide-border rounded-xl border border-border/60 bg-card">
        <Link
          to="/admin/settings/channels/messenger"
          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
        >
          <div className="flex items-center gap-3">
            <ChatBubbleLeftRightIcon className="size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{messenger?.label ?? 'Messenger'}</p>
              <p className="text-xs text-muted-foreground">Widget and portal</p>
            </div>
          </div>
          <Badge size="sm" shape="pill">
            {messengerOn ? 'On' : 'Off'}
          </Badge>
        </Link>
        <Link
          to="/admin/settings/channels/email"
          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
        >
          <div className="flex items-center gap-3">
            <EnvelopeIcon className="size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{email?.label ?? 'Email'}</p>
              <p className="text-xs text-muted-foreground">{emailSubtitle}</p>
            </div>
          </div>
          <Badge size="sm" shape="pill">
            {emailStatus}
          </Badge>
        </Link>
      </div>

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
