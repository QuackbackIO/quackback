import { useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { useUpdateSpamFilterConfig } from '@/lib/client/mutations/settings'
import { useUpdateEmailAutoAck } from '@/lib/client/mutations/channel-settings'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { moduleCrumb } from '@/components/admin/settings/settings-nav-sections'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { LocalDate, NUMERIC_DATE_TIME } from '@/components/ui/local-date'
import { TrustedSendersCard } from '@/components/admin/settings/trusted-senders-card'
import { EmailChannelSettings } from '@/components/admin/channels/email-channel-settings'
import { EmailTransportCard } from '@/components/admin/channels/email-transport-card'

/** Rows of email activity shown before "View all activity". */
const ACTIVITY_PREVIEW_ROWS = 5

export function EmailChannelPage() {
  return (
    <SettingsPage
      page="/admin/settings/channels/email"
      description="Receive and send support conversations from the customer's mailbox."
      crumbs={[
        moduleCrumb('/admin/settings/support'),
        { label: 'Channels', to: '/admin/settings/channels' },
      ]}
    >
      <EmailTransportCard />
      <EmailChannelSettings />
      <TrustedSendersSection />
      <AutoAckCard />
      <EmailActivityCard />
    </SettingsPage>
  )
}

function AutoAckCard() {
  const query = useQuery(channelSettingsQueries.emailAutoAck())
  const update = useUpdateEmailAutoAck()
  const enabled = update.isPending ? update.variables : (query.data?.enabled ?? false)
  return (
    <SettingsCard
      title="Auto-acknowledgement"
      description="Send a short confirmation when a new inbound email opens a conversation."
    >
      <SettingRows>
        <SettingRow
          label="Acknowledge new inbound mail"
          description="Never sent in reply to automated mail, mailing lists, or our own addresses."
          htmlFor="email-auto-ack"
          control={
            <Switch
              id="email-auto-ack"
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

function EmailActivityCard() {
  const query = useQuery(channelSettingsQueries.emailActivity())
  const [showAll, setShowAll] = useState(false)
  const all = query.data ?? []
  const rows = showAll ? all : all.slice(0, ACTIVITY_PREVIEW_ROWS)
  return (
    <SettingsCard
      title="Email activity"
      description="Recent sent and received mail on this workspace."
      action={
        all.length > ACTIVITY_PREVIEW_ROWS ? (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : 'View all activity'}
          </Button>
        ) : undefined
      }
      flush={all.length > 0}
    >
      {all.length === 0 ? (
        <p className="text-sm text-muted-foreground">No email recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-left text-[13px] text-muted-foreground">
              <th className="px-4 py-2 font-normal sm:px-6">Message</th>
              <th className="py-2 font-normal">Status</th>
              <th className="px-4 py-2 text-right font-normal sm:px-6">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2.5 sm:px-6">
                  <span className="capitalize">{row.direction}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span>{row.emailType}</span>
                </td>
                <td className="py-2.5">{row.status}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground sm:px-6">
                  <LocalDate date={row.createdAt} options={NUMERIC_DATE_TIME} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
