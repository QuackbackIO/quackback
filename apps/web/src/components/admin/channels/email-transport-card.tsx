import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'

function TransportValue({ children }: { children: string }) {
  return <span className="text-sm">{children}</span>
}

const OUTBOUND_LABEL = {
  ses: 'Amazon SES',
  smtp: 'SMTP',
  resend: 'Resend',
  console: 'Not configured',
} as const

/** Read-only env probe: outbound provider, from-address, inbound domain. */
export function EmailTransportCard() {
  const { data } = useQuery(channelSettingsQueries.emailStatus())

  if (!data) return null

  const outboundLabel = OUTBOUND_LABEL[data.provider]

  return (
    <SettingsCard title="Transport" description="How this server sends and receives email.">
      <SettingRows>
        <SettingRow
          label="Outbound email"
          control={<TransportValue>{outboundLabel}</TransportValue>}
        />
        <SettingRow
          label="From address"
          control={<TransportValue>{data.fromAddress ?? 'Not set'}</TransportValue>}
        />
        <SettingRow
          label="Inbound replies"
          control={
            <TransportValue>
              {data.inboundConfigured ? (data.inboundDomain ?? 'Configured') : 'Not configured'}
            </TransportValue>
          }
        />
        <SettingRow
          label="Custom sending domains"
          control={
            <TransportValue>
              {data.customDomains === 'available' ? 'Available' : 'Not available'}
            </TransportValue>
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
