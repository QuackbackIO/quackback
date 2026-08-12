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
  useDeleteSendingDomain,
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

/**
 * Show what the server actually refused, falling back to the generic line.
 *
 * The refusals on this card name a specific fix — publish a record, verify a
 * domain first — and swallowing them for a fixed string turns an answerable
 * problem into a mystery.
 */
const reason = (fallback: string) => (error: unknown) =>
  toast.error(error instanceof Error && error.message ? error.message : fallback)

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
              { onSuccess: () => setAddress(''), onError: reason('Could not add the address') }
            )
          }
        >
          Add
        </Button>
      </div>
    </SettingsCard>
  )
}

/** What each record is for, in the words the person publishing it needs. */
const PURPOSE_LABEL: Record<string, string> = {
  ownership: 'Proves this workspace owns the domain',
  dkim: 'Signs your mail',
  'mail-from': 'Aligns SPF with your domain',
}

type DnsRecordView = {
  type: string
  host: string
  value: string
  purpose: string
  priority?: number
}

/**
 * One record, in the order a DNS provider's form asks for it: type, name, value.
 * An MX carries its priority between the two, which is where that field sits in
 * every DNS form and nowhere else.
 */
function DnsRecordRow({ record }: { record: DnsRecordView }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t py-2 first:border-t-0">
      <Badge size="sm" variant="secondary">
        {record.type}
      </Badge>
      {record.priority !== undefined && (
        <Badge size="sm" variant="outline">
          priority {record.priority}
        </Badge>
      )}
      <span className="font-mono text-sm break-all">{record.host}</span>
      <span className="text-sm text-muted-foreground">&rarr;</span>
      <span className="font-mono text-sm break-all">{record.value}</span>
      <span className="w-full text-sm text-muted-foreground">
        {PURPOSE_LABEL[record.purpose] ?? record.purpose}
      </span>
    </div>
  )
}

function SendingDomainsSection({
  domains,
}: {
  domains: {
    id: string
    domain: string
    status: string
    dnsRecords: DnsRecordView[]
  }[]
}) {
  const [domain, setDomain] = useState('')
  const create = useCreateSendingDomain()
  const verify = useVerifySendingDomain()
  const remove = useDeleteSendingDomain()
  return (
    <SettingsCard
      title="Sending domains"
      description="Send from your own domain. Publish these records at your DNS provider, then check them here."
    >
      <div className="space-y-3">
        {domains.map((d) => (
          <div key={d.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{d.domain}</span>
              <Badge size="sm" variant={d.status === 'verified' ? 'default' : 'outline'}>
                {d.status}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={verify.isPending}
                onClick={() =>
                  verify.mutate(d.id, { onError: reason('Could not check the records') })
                }
              >
                {d.status === 'verified' ? 'Re-check' : 'Check records'}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${d.domain}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(d.id, { onError: reason('Could not remove it') })}
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
            {/* Shown after verification too, not only before it. These records
                have to STAY published: the ownership record is what proves the
                domain is still this workspace's, and the scheduled re-check
                un-verifies a domain whose records have gone. Hiding them on
                success would tell a customer they were finished with records
                they must not delete. */}
            {d.dnsRecords.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                {d.status === 'verified' && (
                  <p className="text-sm text-muted-foreground">
                    Keep these published. Removing them stops mail being sent from this domain.
                  </p>
                )}
                {d.dnsRecords.map((r, i) => (
                  <DnsRecordRow key={`${r.type}-${r.host}-${i}`} record={r} />
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
            placeholder="yourcompany.com"
          />
        </div>
        <Button
          disabled={!domain.trim() || create.isPending}
          onClick={() =>
            create.mutate(domain.trim(), {
              onSuccess: () => setDomain(''),
              onError: reason('Could not add the domain'),
            })
          }
        >
          Add domain
        </Button>
      </div>
    </SettingsCard>
  )
}
