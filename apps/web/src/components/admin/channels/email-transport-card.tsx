import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { getEmailChannelStatusFn } from '@/lib/server/functions/settings'

function EmailStatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm">
        <span
          className={
            ok ? 'size-2 rounded-full bg-emerald-500' : 'size-2 rounded-full bg-muted-foreground/40'
          }
          aria-hidden
        />
        {value}
      </span>
    </div>
  )
}

/** Read-only env probe: outbound provider, from-address, inbound domain. */
export function EmailTransportCard() {
  const { data } = useQuery({
    queryKey: ['settings', 'email-channel-status'],
    queryFn: () => getEmailChannelStatusFn(),
    staleTime: 60_000,
  })

  if (!data) return null

  const outboundLabel =
    data.provider === 'smtp' ? 'SMTP' : data.provider === 'ses' ? 'Amazon SES' : 'Not configured'

  return (
    <SettingsCard
      title="Transport"
      description="How conversation emails are sent and received. Configured via environment variables on the server."
    >
      <div className="divide-y divide-border/40">
        <EmailStatusRow
          label="Outbound email"
          value={outboundLabel}
          ok={data.provider !== 'console'}
        />
        <EmailStatusRow
          label="From address"
          value={data.fromAddress ?? 'Not set'}
          ok={!!data.fromAddress}
        />
        <EmailStatusRow
          label="Inbound replies"
          value={data.inboundConfigured ? (data.inboundDomain ?? 'Configured') : 'Not configured'}
          ok={data.inboundConfigured}
        />
      </div>
    </SettingsCard>
  )
}
