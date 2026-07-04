/**
 * Email channel settings (support platform §4.8): the workspace inbound route
 * (where support email is forwarded), per-module sending addresses (where replies
 * come from), and verified sending domains (SPF/DKIM). The v0 owns email at the
 * workspace level; per-team/brand routing rides the same accounts.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrashIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import {
  useCreateInboundRoute,
  useCreateSendingAddress,
  useCreateSendingDomain,
  useVerifySendingDomain,
  useDeleteChannelAccount,
} from '@/lib/client/mutations/channel-accounts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MODULES = ['support', 'feedback', 'changelog'] as const

const fail = (msg: string) => () => toast.error(msg)

export function EmailChannelSettings() {
  const { data } = useQuery(emailChannelConfigQuery())
  return (
    <div className="space-y-6">
      <InboundRouteSection forwardingTarget={inboundTarget(data?.inboundRoute)} />
      <SendingAddressesSection addresses={data?.sendingAddresses ?? []} />
      <SendingDomainsSection domains={data?.domains ?? []} />
    </div>
  )
}

function inboundTarget(
  route: { config: Record<string, unknown> } | null | undefined
): string | null {
  const t = route?.config?.forwardingTarget
  return typeof t === 'string' ? t : null
}

function InboundRouteSection({ forwardingTarget }: { forwardingTarget: string | null }) {
  const [value, setValue] = useState('')
  const create = useCreateInboundRoute()
  return (
    <SettingsCard
      title="Inbound route"
      description="Forward your support inbox here so replies become conversations."
    >
      {forwardingTarget ? (
        <p className="text-sm">
          Forwarding from <span className="font-medium">{forwardingTarget}</span>
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="fwd">Forwarding address</Label>
            <Input
              id="fwd"
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="support@yourcompany.com"
            />
          </div>
          <Button
            disabled={!value.trim() || create.isPending}
            onClick={() =>
              create.mutate(value.trim(), { onError: fail('Could not set the route') })
            }
          >
            Set route
          </Button>
        </div>
      )}
    </SettingsCard>
  )
}

function SendingAddressesSection({
  addresses,
}: {
  addresses: { id: string; address: string | null; module: string | null }[]
}) {
  const [address, setAddress] = useState('')
  const [module, setModule] = useState<(typeof MODULES)[number]>('support')
  const create = useCreateSendingAddress()
  const del = useDeleteChannelAccount()
  return (
    <SettingsCard
      title="Sending addresses"
      description="The From address outbound replies use, per area."
    >
      <div className="space-y-2">
        {addresses.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{a.address}</span>
            <Badge variant="secondary">{a.module}</Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove address"
              onClick={() => del.mutate(a.id, { onError: fail('Could not remove') })}
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="sending">Address</Label>
          <Input
            id="sending"
            type="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="help@yourcompany.com"
          />
        </div>
        <Select value={module} onValueChange={(v) => setModule(v as (typeof MODULES)[number])}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODULES.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!address.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              { address: address.trim(), module },
              { onSuccess: () => setAddress(''), onError: fail('Could not add address') }
            )
          }
        >
          Add
        </Button>
      </div>
    </SettingsCard>
  )
}

function SendingDomainsSection({
  domains,
}: {
  domains: {
    id: string
    domain: string
    status: string
    dnsRecords: { type: string; host: string; value: string; purpose: string }[]
  }[]
}) {
  const [domain, setDomain] = useState('')
  const create = useCreateSendingDomain()
  const verify = useVerifySendingDomain()
  return (
    <SettingsCard
      title="Sending domains"
      description="Verify SPF and DKIM so your mail is trusted and not marked as spam."
    >
      <div className="space-y-3">
        {domains.map((d) => (
          <div key={d.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{d.domain}</span>
              <Badge variant={d.status === 'verified' ? 'default' : 'outline'}>{d.status}</Badge>
              {d.status !== 'verified' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={verify.isPending}
                  onClick={() => verify.mutate(d.id, { onError: fail('Verification failed') })}
                >
                  Verify
                </Button>
              )}
            </div>
            {d.status !== 'verified' && d.dnsRecords.length > 0 && (
              <div className="mt-2 space-y-1 overflow-x-auto">
                {d.dnsRecords.map((r, i) => (
                  <div
                    key={i}
                    className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                  >
                    {r.type} {r.host} → {r.value}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="domain">Domain</Label>
          <Input
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="mail.yourcompany.com"
          />
        </div>
        <Button
          disabled={!domain.trim() || create.isPending}
          onClick={() =>
            create.mutate(domain.trim(), {
              onSuccess: () => setDomain(''),
              onError: fail('Could not add domain'),
            })
          }
        >
          Add domain
        </Button>
      </div>
    </SettingsCard>
  )
}
