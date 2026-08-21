/**
 * Email channel settings: inbound route (edit/remove + sender trust),
 * per-module sending addresses (SMTP override + domain subtitle), and
 * verified sending domains (FK-guarded delete).
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
  useUpdateInboundTrust,
  useClearInboundForwarding,
  useUpdateSendingAddressSmtp,
} from '@/lib/client/mutations/channel-accounts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/shared/utils'

const MODULES = ['support', 'feedback', 'changelog'] as const
const MODULE_LABEL: Record<(typeof MODULES)[number], string> = {
  support: 'Support',
  feedback: 'Feedback',
  changelog: 'Changelog',
}

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
      <InboundRouteSection
        forwardingTarget={inboundTarget(data?.inboundRoute)}
        platformAddress={data?.platformAddress ?? null}
        inboundTrust={data?.inboundRoute?.inboundTrust ?? 'strict'}
      />
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

function InboundRouteSection({
  forwardingTarget,
  platformAddress,
  inboundTrust,
}: {
  forwardingTarget: string | null
  platformAddress: string | null
  inboundTrust: 'strict' | 'lenient'
}) {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const create = useCreateInboundRoute()
  const clear = useClearInboundForwarding()
  const trust = useUpdateInboundTrust()

  const showEditor = !forwardingTarget || editing

  return (
    <SettingsCard
      title="Inbound route"
      description="Forward your support inbox here so replies become conversations."
    >
      {platformAddress && (
        <p className="text-sm">
          Email to <span className="font-medium">{platformAddress}</span> becomes a conversation.
        </p>
      )}
      {forwardingTarget && !editing ? (
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium truncate">{forwardingTarget}</p>
            {platformAddress && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Forwarding to {platformAddress}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setValue(forwardingTarget)
                setEditing(true)
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate(undefined, {
                  onError: reason('Could not remove the route'),
                })
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ) : showEditor ? (
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
              create.mutate(value.trim(), {
                onSuccess: () => {
                  setValue('')
                  setEditing(false)
                },
                onError: fail('Could not set the route'),
              })
            }
          >
            {forwardingTarget ? 'Save' : 'Set route'}
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-4">
        <div className="pr-4">
          <p className="text-sm font-medium">Sender trust</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Strict quarantines mail that fails authentication. Lenient accepts it with an unverified
            badge.
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-border p-0.5">
          {(['strict', 'lenient'] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={trust.isPending}
              onClick={() =>
                trust.mutate(option, { onError: reason('Could not update sender trust') })
              }
              className={cn(
                'rounded-md px-2.5 py-1 text-[13px] font-medium capitalize transition-colors',
                inboundTrust === option
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </SettingsCard>
  )
}

function SendingAddressesSection({
  addresses,
}: {
  addresses: {
    id: string
    address: string | null
    module: string | null
    config: Record<string, unknown>
    sendingDomain: { domain: string; status: string } | null
  }[]
}) {
  const [address, setAddress] = useState('')
  const [module, setModule] = useState<(typeof MODULES)[number]>('support')
  const [smtpFor, setSmtpFor] = useState<{
    id: string
    address: string
    smtp?: { host?: string; port?: number; secure?: boolean; user?: string }
  } | null>(null)
  const create = useCreateSendingAddress()
  const del = useDeleteChannelAccount()

  return (
    <SettingsCard
      title="Sending addresses"
      description="The From address outbound replies use, per area."
    >
      <div className="space-y-2">
        {addresses.map((a) => {
          const smtp = a.config.smtp as
            | { host?: string; port?: number; secure?: boolean; user?: string }
            | undefined
          return (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono truncate">{a.address}</span>
                  <Badge size="sm" variant="secondary">
                    {MODULE_LABEL[(a.module as (typeof MODULES)[number]) ?? 'support'] ?? a.module}
                  </Badge>
                </div>
                {a.sendingDomain && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.sendingDomain.domain} · {a.sendingDomain.status}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSmtpFor({
                    id: a.id,
                    address: a.address ?? '',
                    smtp,
                  })
                }
              >
                SMTP override
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove address"
                onClick={() => del.mutate(a.id, { onError: fail('Could not remove') })}
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
          )
        })}
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
                {MODULE_LABEL[m]}
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
      <SmtpOverrideDialog target={smtpFor} onClose={() => setSmtpFor(null)} />
    </SettingsCard>
  )
}

function SmtpOverrideDialog({
  target,
  onClose,
}: {
  target: {
    id: string
    address: string
    smtp?: { host?: string; port?: number; secure?: boolean; user?: string }
  } | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target ? <SmtpOverrideForm key={target.id} target={target} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function SmtpOverrideForm({
  target,
  onClose,
}: {
  target: {
    id: string
    address: string
    smtp?: { host?: string; port?: number; secure?: boolean; user?: string }
  }
  onClose: () => void
}) {
  const save = useUpdateSendingAddressSmtp()
  const [host, setHost] = useState(target.smtp?.host ?? '')
  const [port, setPort] = useState(String(target.smtp?.port ?? 587))
  const [user, setUser] = useState(target.smtp?.user ?? '')
  const [secure, setSecure] = useState(target.smtp?.secure ?? true)

  return (
    <>
      <DialogHeader>
        <DialogTitle>SMTP override</DialogTitle>
        <DialogDescription>
          Send from {target.address} through a dedicated SMTP server.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="smtp-host">Host</Label>
          <Input
            id="smtp-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.example.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-user">Username</Label>
            <Input id="smtp-user" value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between py-1">
          <Label htmlFor="smtp-secure">Use TLS</Label>
          <Switch id="smtp-secure" checked={secure} onCheckedChange={setSecure} />
        </div>
      </div>
      <DialogFooter>
        {target.smtp && (
          <Button
            variant="ghost"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { id: target.id, smtp: null },
                {
                  onSuccess: onClose,
                  onError: reason('Could not clear the override'),
                }
              )
            }
          >
            Clear
          </Button>
        )}
        <Button
          disabled={!host.trim() || !user.trim() || save.isPending}
          onClick={() => {
            const parsedPort = Number(port)
            if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
              toast.error('Enter a valid port.')
              return
            }
            save.mutate(
              {
                id: target.id,
                smtp: { host: host.trim(), port: parsedPort, secure, user: user.trim() },
              },
              { onSuccess: onClose, onError: reason('Could not save the override') }
            )
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
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
      description="Verify SPF and DKIM so your mail is trusted."
    >
      <div className="space-y-3">
        {domains.map((d) => (
          <div key={d.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium font-mono">{d.domain}</span>
              <Badge size="sm" variant={d.status === 'verified' ? 'default' : 'outline'}>
                {d.status === 'verified'
                  ? 'Verified'
                  : d.status === 'pending'
                    ? 'Pending'
                    : d.status}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={verify.isPending}
                onClick={() =>
                  verify.mutate(d.id, { onError: reason('Could not check the records') })
                }
              >
                {d.status === 'verified' ? 'Re-check' : 'Verify'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${d.domain}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(d.id, { onError: reason('Could not remove it') })}
              >
                Delete
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
