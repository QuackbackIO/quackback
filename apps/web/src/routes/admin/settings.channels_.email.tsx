import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { EnvelopeIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateSpamFilterConfig } from '@/lib/client/mutations/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { TrustedSendersCard } from '@/components/admin/settings/trusted-senders-card'
import { EmailChannelSettings } from '@/components/admin/channels/email-channel-settings'
import { EmailTransportCard } from '@/components/admin/channels/email-transport-card'
import { getChannelDescriptor } from '@/lib/shared/channels'

export const Route = createFileRoute('/admin/settings/channels/email')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)
    await context.queryClient.ensureQueryData(settingsQueries.spamFilterConfig())
    return {}
  },
  component: EmailChannelRoute,
})

function EmailChannelRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) return <Navigate to="/admin/settings" />
  return <EmailChannelPage />
}

function EmailChannelPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings/channels">Channels</BackLink>
      </div>
      <PageHeader
        icon={EnvelopeIcon}
        title="Email"
        description="Receive and send support conversations from the customer's mailbox."
      />
      <EmailTransportCard />
      <EmailChannelSettings />
      <TrustedSendersSection />
      <SettingsCard
        title="Reopen on reply"
        description="Email replies always reopen a closed conversation."
      >
        <div className="flex items-center justify-between py-1">
          <p className="text-sm text-muted-foreground">
            {getChannelDescriptor('email')?.reopenOnReply === 'always'
              ? 'Always on'
              : 'Configurable'}
          </p>
          <Badge size="sm" shape="pill">
            Always on
          </Badge>
        </div>
      </SettingsCard>
    </div>
  )
}

function TrustedSendersSection() {
  const spamFilterQuery = useSuspenseQuery(settingsQueries.spamFilterConfig())
  const updateSpamFilterConfig = useUpdateSpamFilterConfig()
  return (
    <TrustedSendersCard
      entries={spamFilterQuery.data.trustedSenders}
      onSave={async (trustedSenders) => {
        await updateSpamFilterConfig.mutateAsync({ trustedSenders })
      }}
    />
  )
}
