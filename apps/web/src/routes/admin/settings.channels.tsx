import { createFileRoute, Navigate } from '@tanstack/react-router'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { EmailChannelSettings } from '@/components/admin/channels/email-channel-settings'

export const Route = createFileRoute('/admin/settings/channels')({
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    return {}
  },
  component: ChannelsSettingsRoute,
})

/** Gate behind the `supportInbox` flag, mirroring the messenger settings page. */
function ChannelsSettingsRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <ChannelsSettingsPage />
}

/** Email routing and identity (§4.8): the inbound route plus per-module sending addresses and domains. */
function ChannelsSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={EnvelopeIcon}
        title="Emails"
        description="Route inbound support email and choose the addresses each product sends from"
      />
      <EmailChannelSettings />
    </div>
  )
}
