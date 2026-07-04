import { createFileRoute } from '@tanstack/react-router'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { EmailChannelSettings } from '@/components/admin/channels/email-channel-settings'

export const Route = createFileRoute('/admin/settings/channels')({
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    return {}
  },
  component: ChannelsSettingsPage,
})

/** Email channel settings (§4.8): inbound routing, sending addresses, domains. */
function ChannelsSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={EnvelopeIcon}
        title="Email channel"
        description="Route inbound support email and send replies from your own addresses"
      />
      <EmailChannelSettings />
    </div>
  )
}
