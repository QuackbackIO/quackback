import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { EnvelopeIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateSpamFilterConfig } from '@/lib/client/mutations/settings'
import { ChannelSettingsCrumb } from '@/components/admin/settings/channel-settings-crumb'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { TrustedSendersCard } from '@/components/admin/settings/trusted-senders-card'
import { EmailChannelSettings } from '@/components/admin/channels/email-channel-settings'
import { EmailTransportCard } from '@/components/admin/channels/email-transport-card'
import { fetchEmailAutoAckFn, updateEmailAutoAckFn } from '@/lib/server/functions/settings'
import { listRecentEmailLogFn } from '@/lib/server/functions/channel-accounts'

export const Route = createFileRoute('/admin/settings/channels_/email')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)
    await context.queryClient.ensureQueryData(settingsQueries.spamFilterConfig())
    return {}
  },
  component: EmailChannelPage,
})

function EmailChannelPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-1.5">
        <ChannelSettingsCrumb page="Email" />
        <PageHeader
          icon={EnvelopeIcon}
          title="Email"
          description="Receive and send support conversations from the customer's mailbox."
        />
      </div>
      <EmailTransportCard />
      <EmailChannelSettings />
      <TrustedSendersSection />
      <AutoAckCard />
      <EmailActivityCard />
      <SettingsCard
        title="Reopen on reply"
        description="Email replies always reopen a closed conversation."
      >
        <div className="flex items-center justify-end py-1">
          <Badge size="sm" shape="pill">
            Always on
          </Badge>
        </div>
      </SettingsCard>
    </div>
  )
}

function AutoAckCard() {
  const query = useQuery({
    queryKey: ['email-auto-ack'],
    queryFn: () => fetchEmailAutoAckFn(),
  })
  const [override, setOverride] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const enabled = override ?? query.data?.enabled ?? false
  return (
    <SettingsCard
      title="Auto-acknowledgement"
      description="Send a short confirmation when a new inbound email opens a conversation. Off by default."
    >
      <div className="flex items-center justify-between py-1">
        <div className="pr-4">
          <Label htmlFor="email-auto-ack" className="text-sm font-medium cursor-pointer">
            Acknowledge new inbound mail
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Never sent in reply to automated mail, mailing lists, or our own addresses.
          </p>
        </div>
        <Switch
          id="email-auto-ack"
          checked={enabled}
          disabled={saving || query.isLoading}
          onCheckedChange={async (checked) => {
            setOverride(checked)
            setSaving(true)
            try {
              await updateEmailAutoAckFn({ data: { enabled: checked } })
            } catch {
              setOverride(!checked)
            } finally {
              setSaving(false)
            }
          }}
        />
      </div>
    </SettingsCard>
  )
}

function EmailActivityCard() {
  const query = useQuery({
    queryKey: ['email-activity'],
    queryFn: () => listRecentEmailLogFn(),
  })
  const rows = query.data ?? []
  return (
    <SettingsCard
      title="Email activity"
      description="Recent sent and received mail on this workspace."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No email recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium capitalize">{row.direction}</span>
                <span className="text-muted-foreground"> · {row.emailType}</span>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {row.status} · {new Date(row.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
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
