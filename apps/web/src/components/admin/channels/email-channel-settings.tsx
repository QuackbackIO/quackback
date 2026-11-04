/**
 * Email channel settings: inbound route (edit/remove + sender trust) and one
 * card of sending addresses. An address on a domain that is not live yet
 * carries that domain's setup panel under it; the default address is always
 * the first row, so the card says what replies go out as today.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EnvelopeIcon, GlobeAltIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { PhaseBadge } from './phase-badge'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import {
  useCreateInboundRoute,
  useCreateSendingAddress,
  useDeleteSendingDomain,
  useDeleteChannelAccount,
  useRestartSendingDomainChecks,
  useSendTestEmail,
  useUpdateInboundTrust,
  useClearInboundForwarding,
  useUpdateSendingAddressSmtp,
} from '@/lib/client/mutations/channel-accounts'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { DomainSetupPanel } from './domain-setup-panel'
import { SendingPausedNotice } from './sending-paused-notice'
import {
  domainPhase,
  failingRecordName,
  signingKeyFailing,
  signingKeyProblem,
  type DomainPhase,
} from './sending-domain-view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      <SendingPausedNotice paused={data?.sendingPaused ?? null} />
      <InboundRouteSection
        forwardingTarget={inboundTarget(data?.inboundRoute)}
        platformAddress={data?.platformAddress ?? null}
        inboundTrust={data?.inboundRoute?.inboundTrust ?? 'strict'}
      />
      <SendingAddressesSection
        addresses={data?.sendingAddresses ?? []}
        domains={data?.domains ?? []}
        defaultFrom={data?.defaultFrom ?? null}
        available={data?.addressMode !== 'unavailable'}
        guardPermitsAny={data?.addressMode === 'any'}
      />
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
  const [confirmClear, setConfirmClear] = useState(false)
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
        <p className="mb-4 text-[13px] text-muted-foreground">
          Email to <span className="font-medium text-foreground">{platformAddress}</span> becomes a
          conversation.
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
              onClick={() => setConfirmClear(true)}
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
            variant="outline"
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
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Delete inbound route?"
        description="Forwarded email stops becoming conversations until you set a route again."
        confirmLabel="Delete route"
        variant="destructive"
        isPending={clear.isPending}
        onConfirm={() => {
          clear.mutate(undefined, { onError: reason('Could not remove the route') })
          setConfirmClear(false)
        }}
      />
    </SettingsCard>
  )
}

type SendingAddress = {
  id: string
  address: string | null
  module: string | null
  config: Record<string, unknown>
  sendingDomainId?: string | null
  sendingDomain: { domain: string; status: string } | null
  createdAt?: string
}

type SmtpConfig = { host?: string; port?: number; secure?: boolean; user?: string }

/** The bare address inside a `Name <address>` From, or the string as given. */
const bareAddress = (from: string): string => /<([^>]+)>/.exec(from)?.[1] ?? from

const moduleLabel = (module: string | null): string =>
  MODULE_LABEL[(module ?? 'support') as (typeof MODULES)[number]] ?? module ?? ''

/** "Feedback and Changelog", "Support, Feedback and Changelog". */
const listOf = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * The domain row an address sends through: the one it is linked to, else the
 * one whose zone it is in (addresses added before linking carry no id).
 */
function domainOf(a: SendingAddress, domains: SendingDomainDTO[]): SendingDomainDTO | null {
  if (a.sendingDomainId) {
    const linked = domains.find((d) => d.id === a.sendingDomainId)
    if (linked) return linked
  }
  const at = a.address?.split('@')[1]?.toLowerCase()
  if (!at) return null
  return domains.find((d) => at === d.domain || at.endsWith(`.${d.domain}`)) ?? null
}

/** The meta line of the default address: which areas it still answers for. */
function defaultMeta(uncovered: string[]): string {
  return uncovered.length === MODULES.length || uncovered.length === 0
    ? 'Default'
    : `Default for ${listOf(uncovered)}`
}

/** The meta line of a row whose domain is not live yet. */
function pendingMeta(
  domain: SendingDomainDTO,
  phase: DomainPhase,
  first: boolean,
  area: string,
  fallback: string
): string | null {
  if (phase === 'live') return null
  if (!first) return `${area} · Waiting for ${domain.domain}`
  if (signingKeyFailing(domain, phase)) return `${signingKeyProblem(domain.domain)}${fallback}`
  if (phase === 'not-found') return `Records not found after 72 hours.${fallback}`
  if (phase === 'attention') {
    const failing = domain.dnsRecords.find((r) => r.check && r.check.state !== 'found')
    const name = failingRecordName(domain)
    if (failing && name) {
      const what =
        failing.check?.state === 'missing'
          ? 'is missing'
          : failing.check?.state === 'proxied'
            ? 'is proxied'
            : 'has the wrong value'
      return `The ${name} ${what}.${fallback}`
    }
    return `${domain.domain} needs attention.${fallback}`
  }
  return null
}

function SendingAddressesSection({
  addresses,
  domains,
  defaultFrom,
  available,
  guardPermitsAny,
}: {
  addresses: SendingAddress[]
  domains: SendingDomainDTO[]
  defaultFrom: string | null
  available: boolean
  /** One workspace: replies still leave as the address, so nothing falls back. */
  guardPermitsAny: boolean
}) {
  const [address, setAddress] = useState('')
  const [module, setModule] = useState<(typeof MODULES)[number]>('support')
  const [smtpFor, setSmtpFor] = useState<{ id: string; address: string; smtp?: SmtpConfig } | null>(
    null
  )
  const [domainRemoveTarget, setDomainRemoveTarget] = useState<{
    id: string
    domain: string
  } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{
    id: string
    alsoDomain: string | null
  } | null>(null)
  // Records of live domains the person opened from the row menu, by domain.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // One inline line for the last failed action, cleared when the next starts:
  // these failures name a fix, and a toast is gone before it is read.
  const [actionError, setActionError] = useState<string | null>(null)
  const create = useCreateSendingAddress()
  const del = useDeleteChannelAccount()
  const removeDomain = useDeleteSendingDomain()
  const restart = useRestartSendingDomainChecks()
  const sendTest = useSendTestEmail()
  const showError = (fallback: string) => (error: unknown) =>
    setActionError(errorText(error, fallback))
  const now = new Date()
  // What replies do meanwhile: one workspace still sends as the address; a
  // shared server falls back to the default.
  const fallbackNote = guardPermitsAny
    ? ' Replies still send from this address but may land in spam until this is fixed.'
    : ' Replies send from the default address.'

  const rows = addresses.map((a) => {
    const domain = domainOf(a, domains)
    return { a, domain, phase: domain ? domainPhase(domain, now) : ('live' as const) }
  })
  // Listed oldest first: the panel and the domain's status line sit under the
  // address that has been on the domain longest, so adding another one does
  // not move them, and the newest address sits next to the Add form.
  const firstOnDomain = new Set<string>()
  const seen = new Set<string>()
  const oldestFirst = [...rows].sort((x, y) =>
    (x.a.createdAt ?? '').localeCompare(y.a.createdAt ?? '')
  )
  for (const { a, domain } of oldestFirst) {
    if (domain && !seen.has(domain.id)) {
      seen.add(domain.id)
      firstOnDomain.add(a.id)
    }
  }
  // Domains no address uses: added before addresses brought their domains,
  // or left behind. Listed so they can be finished or removed.
  const unused = domains
    .filter((d) => !rows.some((r) => r.domain?.id === d.id))
    .map((d) => ({ domain: d, phase: domainPhase(d, now) }))
  const setupPanel = (domain: SendingDomainDTO, phase: DomainPhase) => (
    <DomainSetupPanel
      domain={domain}
      phase={phase}
      checking={restart.isPending}
      onCheckAgain={() => {
        setActionError(null)
        restart.mutate(domain.id, { onError: showError("Couldn't check the records.") })
      }}
    />
  )
  const uncovered = MODULES.filter(
    (m) => !rows.some((r) => r.a.module === m && r.phase === 'live')
  ).map((m) => MODULE_LABEL[m])

  return (
    <SettingsCard
      title="Sending addresses"
      description="The From address outbound replies use, per area."
      flush
    >
      <SettingsList>
        <SettingsListRow
          leading={<RowIcon icon={EnvelopeIcon} />}
          title={defaultFrom ? bareAddress(defaultFrom) : 'Default address'}
          meta={defaultMeta(uncovered)}
        />
        {oldestFirst.map(({ a, domain, phase }) => {
          const smtp = a.config.smtp as SmtpConfig | undefined
          const first = firstOnDomain.has(a.id)
          // Always open while the domain needs its records; opened from the menu once live.
          const open = domain ? phase !== 'live' || (expanded[domain.id] ?? false) : false
          const label = a.address ?? ''
          const items = [
            ...(domain && phase === 'live'
              ? [
                  {
                    label: 'Send test email',
                    onSelect: () => {
                      setActionError(null)
                      sendTest.mutate(a.id, {
                        onSuccess: (r) =>
                          toast.success(
                            bareAddress(r.from) === label
                              ? `Test sent to ${r.to}`
                              : `Test sent to ${r.to} from ${bareAddress(r.from)}`
                          ),
                        onError: showError("Couldn't send the test email."),
                      })
                    },
                  },
                ]
              : []),
            ...(domain && first && phase === 'live'
              ? [
                  {
                    label: open ? 'Hide DNS records' : 'DNS records',
                    onSelect: () => setExpanded((e) => ({ ...e, [domain.id]: !open })),
                  },
                ]
              : []),
            {
              label: 'SMTP override',
              onSelect: () => setSmtpFor({ id: a.id, address: label, smtp }),
            },
            {
              label: 'Remove',
              destructive: true,
              onSelect: () =>
                setRemoveTarget({
                  id: a.id,
                  // Removing the last address on a domain removes the domain too.
                  alsoDomain:
                    domain && rows.filter((r) => r.domain?.id === domain.id).length === 1
                      ? domain.domain
                      : null,
                }),
            },
          ]
          return (
            <div key={a.id}>
              <SettingsListRow
                leading={<RowIcon icon={EnvelopeIcon} />}
                title={label}
                meta={
                  (domain &&
                    pendingMeta(domain, phase, first, moduleLabel(a.module), fallbackNote)) ||
                  moduleLabel(a.module)
                }
                wrapMeta={phase !== 'live'}
                badges={<PhaseBadge phase={phase} />}
                actions={items}
              />
              {domain && first && open && setupPanel(domain, phase)}
            </div>
          )
        })}
        {unused.map(({ domain, phase }) => {
          const open = phase !== 'live' || (expanded[domain.id] ?? false)
          return (
            <div key={domain.id}>
              <SettingsListRow
                leading={<RowIcon icon={GlobeAltIcon} />}
                title={domain.domain}
                meta="No address uses this domain"
                badges={<PhaseBadge phase={phase} />}
                actions={[
                  ...(phase === 'live'
                    ? [
                        {
                          label: open ? 'Hide DNS records' : 'DNS records',
                          onSelect: () => setExpanded((e) => ({ ...e, [domain.id]: !open })),
                        },
                      ]
                    : []),
                  {
                    label: 'Remove',
                    destructive: true,
                    onSelect: () => setDomainRemoveTarget({ id: domain.id, domain: domain.domain }),
                  },
                ]}
              />
              {open && setupPanel(domain, phase)}
            </div>
          )
        })}
      </SettingsList>
      <div className="space-y-2 border-t border-border/50 px-4 py-3 sm:px-6">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="sending">Address</Label>
            <Input
              id="sending"
              type="email"
              value={address}
              disabled={!available}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="help@yourcompany.com"
            />
          </div>
          <Select
            value={module}
            disabled={!available}
            onValueChange={(v) => setModule(v as (typeof MODULES)[number])}
          >
            <SelectTrigger className="w-32" aria-label="Area">
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
            variant="outline"
            disabled={!available || !address.trim() || create.isPending}
            onClick={() => {
              setActionError(null)
              create.mutate(
                { address: address.trim(), module },
                {
                  onSuccess: () => setAddress(''),
                  onError: showError("Couldn't add the address."),
                }
              )
            }}
          >
            Add
          </Button>
        </div>
        {!available && (
          <p className="text-[13px] text-muted-foreground">
            Custom sending addresses aren&apos;t available on this server.
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        )}
      </div>
      <SmtpOverrideDialog target={smtpFor} onClose={() => setSmtpFor(null)} />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Delete address?"
        description={
          removeTarget?.alsoDomain
            ? `Replies can no longer be sent from this address. ${removeTarget.alsoDomain} will be removed too.`
            : 'Replies can no longer be sent from this address.'
        }
        confirmLabel="Delete address"
        variant="destructive"
        isPending={del.isPending}
        onConfirm={() => {
          if (removeTarget) {
            const { id, alsoDomain } = removeTarget
            setActionError(null)
            del.mutate(id, {
              // Only the domain the dialog named, and only when the server
              // agrees no address uses it any more.
              onSuccess: ({ lastOnDomain }) => {
                if (alsoDomain && lastOnDomain?.domain === alsoDomain) {
                  removeDomain.mutate(lastOnDomain.id, {
                    onError: showError("Couldn't remove the domain."),
                  })
                }
              },
              onError: showError("Couldn't remove the address."),
            })
          }
          setRemoveTarget(null)
        }}
      />
      <ConfirmDialog
        open={domainRemoveTarget !== null}
        onOpenChange={(open) => !open && setDomainRemoveTarget(null)}
        title={domainRemoveTarget ? `Remove ${domainRemoveTarget.domain}?` : 'Remove domain?'}
        description="Its DNS records can be deleted afterwards."
        confirmLabel="Remove domain"
        variant="destructive"
        isPending={removeDomain.isPending}
        onConfirm={() => {
          if (domainRemoveTarget) {
            setActionError(null)
            removeDomain.mutate(domainRemoveTarget.id, {
              onError: showError("Couldn't remove the domain."),
            })
          }
          setDomainRemoveTarget(null)
        }}
      />
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

/** The server's sentence for a failed action, or the generic line. */
const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback
