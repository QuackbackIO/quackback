/**
 * Email settings, in two parts. The workspace part (Settings → Email) holds the
 * sending addresses and which of them each kind of email is sent from, because
 * feedback, changelog and status email send whether or not Support is on. The
 * support part (Support → Channels → Email) holds the support inbox and where
 * support replies come from. An address on a domain that is not live yet
 * carries that domain's setup panel under it.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EnvelopeIcon, GlobeAltIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { PhaseBadge } from './phase-badge'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import {
  useCreateInboundRoute,
  useDeleteSendingDomain,
  useDeleteChannelAccount,
  useRestartSendingDomainChecks,
  useSendTestEmail,
  useUpdateInboundTrust,
  useClearInboundForwarding,
} from '@/lib/client/mutations/channel-accounts'
import type { EmailSendersDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { DomainSetupPanel } from './domain-setup-panel'
import { SendingPausedNotice } from './sending-paused-notice'
import { SENDER_SURFACE_NAMES, SendFromCard, type SenderIdentity } from './send-from-card'
import {
  errorText,
  SendingAddressDialog,
  type SendingAddressDialogTarget,
} from './sending-address-dialog'
import {
  domainPhase,
  failingRecordName,
  ownershipWarning,
  signingKeyFailing,
  signingKeyProblem,
  type DomainPhase,
} from './sending-domain-view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shared/utils'
import { toastError } from '@/lib/client/error-notice'

const NO_SENDERS: EmailSendersDTO = {
  default: null,
  support: null,
  feedback: null,
  changelog: null,
  status: null,
}

/**
 * Show what the server actually refused, falling back to the generic line.
 *
 * The refusals on this card name a specific fix — publish a record, verify a
 * domain first — and swallowing them for a fixed string turns an answerable
 * problem into a mystery.
 */
const reason = (fallback: string) => (error: unknown) => toastError(error, fallback)

/** The email config as both pages read it: addresses named and checked. */
function useEmailConfigView() {
  const { data } = useQuery(emailChannelConfigQuery())
  const workspaceName = data?.workspaceName ?? ''
  const addresses = data?.sendingAddresses ?? []
  const domains = data?.domains ?? []
  // Named by the server, the way the send itself names it.
  const platformFrom = data?.defaultFrom ?? null
  // One workspace on its own server falls back to that server's own address.
  const platformName = data?.addressMode === 'any' ? 'Server default' : 'Quackback address'
  // The workspace's own inbox on the platform, which a reply to an emailed-in
  // conversation falls back to before the platform's general address.
  const platformInbox = data?.platformAddress
    ? workspaceName
      ? `${workspaceName} <${data.platformAddress}>`
      : data.platformAddress
    : null
  // Whether an address can send is the send guard's answer, from the server.
  const now = new Date()
  const identities: SenderIdentity[] = oldestFirst(addresses).map((a) => {
    const domain = domainOf(a, domains)
    return {
      id: a.id,
      label: senderLabel(a, workspaceName),
      live: a.sendable,
      lapsed: !a.sendable && !!domain && domainPhase(domain, now) === 'attention',
    }
  })
  return {
    data,
    workspaceName,
    addresses,
    domains,
    senders: data?.senders ?? NO_SENDERS,
    platformFrom,
    platformName,
    platformInbox,
    identities,
  }
}

/** A kind of email with its own sender, other than the workspace default. */
export type SenderSurfaceKey = Exclude<keyof EmailSendersDTO, 'default'>

/**
 * Settings → Email: the addresses this workspace sends from, and which of them
 * the default and each product that is on uses.
 */
export function WorkspaceEmailSettings({ surfaces }: { surfaces: readonly SenderSurfaceKey[] }) {
  const view = useEmailConfigView()
  const { data } = view
  return (
    <div className="space-y-6">
      <SendingPausedNotice
        paused={data?.sendingPaused ?? null}
        ownServer={data?.addressMode === 'any'}
      />
      <SendingAddressesSection
        addresses={view.addresses}
        domains={view.domains}
        senders={view.senders}
        workspaceName={view.workspaceName}
        platformFrom={view.platformFrom}
        platformName={view.platformName}
        available={data?.addressMode !== 'unavailable'}
        guardPermitsAny={data?.addressMode === 'any'}
        setsUpDomains={data?.addressMode === 'verified-domains'}
        ownDomains={ownDomains(data?.platformAddress, data?.defaultFrom)}
        loaded={data !== undefined}
      />
      {/* With no address there is nothing to choose between, so the card
          waits for one rather than showing a row of single-option selects. */}
      {view.addresses.length > 0 && (
        <SendFromCard
          senders={view.senders}
          identities={view.identities}
          platformFrom={view.platformFrom}
          platformName={view.platformName}
          platformInbox={view.platformInbox}
          forwardingTarget={inboundTarget(data?.inboundRoute)}
          forwardingTargetPermitted={data?.forwardingTargetPermitted ?? null}
          hasInboundRoute={!!data?.inboundRoute}
          rows={['default', ...surfaces]}
          // Where "Change" on a product's page lands: `SEND_FROM_ANCHOR` in
          // surface-sender-row.tsx, repeated here because importing that row
          // would load it with this page. A test holds the two together.
          id="send-from"
          onError={reason("Couldn't change where email is sent from.")}
        />
      )}
    </div>
  )
}

/**
 * Support → Channels → Email: the support inbox, and the one sender a support
 * lead may choose, where support replies come from. The addresses themselves
 * are managed on Settings → Email.
 */
export function SupportInboxSettings({ canManageSending }: { canManageSending: boolean }) {
  const view = useEmailConfigView()
  const { data } = view
  return (
    <div className="space-y-6">
      <SendingPausedNotice
        paused={data?.sendingPaused ?? null}
        ownServer={data?.addressMode === 'any'}
      />
      <InboundRouteSection
        forwardingTarget={inboundTarget(data?.inboundRoute)}
        platformAddress={data?.platformAddress ?? null}
        inboundTrust={data?.inboundRoute?.inboundTrust ?? 'strict'}
      />
      <SendFromCard
        senders={view.senders}
        identities={view.identities}
        platformFrom={view.platformFrom}
        platformName={view.platformName}
        platformInbox={view.platformInbox}
        forwardingTarget={inboundTarget(data?.inboundRoute)}
        forwardingTargetPermitted={data?.forwardingTargetPermitted ?? null}
        hasInboundRoute={!!data?.inboundRoute}
        rows={['support']}
        title="Replies"
        description={
          canManageSending
            ? 'The address support replies come from.'
            : 'The address support replies come from. An admin adds sending addresses in Settings > Email.'
        }
        action={
          canManageSending ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/settings/email">Manage sending addresses</Link>
            </Button>
          ) : undefined
        }
        onError={reason("Couldn't change where support replies come from.")}
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

/** How the two inbound trust settings are offered. */
const TRUST_OPTIONS = [
  { value: 'strict', label: 'Quarantine' },
  { value: 'lenient', label: 'Accept' },
] as const

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
  // One inline line for the last failed action, as on the Sending addresses card.
  const [actionError, setActionError] = useState<string | null>(null)
  const create = useCreateInboundRoute()
  const clear = useClearInboundForwarding()
  const trust = useUpdateInboundTrust()
  const showError = (fallback: string) => (error: unknown) =>
    setActionError(errorText(error, fallback))

  const showEditor = !forwardingTarget || editing

  return (
    <SettingsCard
      title="Support inbox"
      description="Forward your support address here so its email becomes conversations."
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
            onClick={() => {
              setActionError(null)
              create.mutate(value.trim(), {
                onSuccess: () => {
                  setValue('')
                  setEditing(false)
                },
                onError: showError("Couldn't save the forwarding address."),
              })
            }}
          >
            Save
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
          <p className="text-sm font-medium">Unverified senders</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Quarantine moves email that fails authentication to Spam. Accept lets it in, marked
            unverified.
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-border p-0.5">
          {TRUST_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={trust.isPending}
              onClick={() => {
                setActionError(null)
                trust.mutate(option.value, {
                  onError: showError("Couldn't change unverified senders."),
                })
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
                inboundTrust === option.value
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {actionError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {actionError}
        </p>
      )}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Remove the forwarding address?"
        description="Forwarded email stops becoming conversations until you set an address again."
        confirmLabel="Remove"
        variant="destructive"
        isPending={clear.isPending}
        onConfirm={() => {
          setActionError(null)
          clear.mutate(undefined, {
            onError: showError("Couldn't remove the forwarding address."),
          })
          setConfirmClear(false)
        }}
      />
    </SettingsCard>
  )
}

type SendingAddress = {
  id: string
  address: string | null
  senderName?: string | null
  config: Record<string, unknown>
  sendingDomainId?: string | null
  sendingDomain: { domain: string; status: string } | null
  createdAt?: string
  /** Whether email can leave from it right now (the send guard's answer). */
  sendable: boolean
}

/** "Sender name <address>", the sender name being the workspace's when unset. */
const senderLabel = (a: SendingAddress, workspaceName: string): string => {
  const name = a.senderName ?? workspaceName
  return name ? `${name} <${a.address ?? ''}>` : (a.address ?? '')
}

/**
 * The domains of the platform's own addresses (the workspace's inbox on it and
 * the address email leaves from by default), which need no setup to send from.
 */
const ownDomains = (...addresses: Array<string | null | undefined>): string[] =>
  addresses.flatMap((a) => {
    const domain = /@([^\s<>@]+)>?\s*$/.exec(a ?? '')?.[1]?.toLowerCase()
    return domain ? [domain] : []
  })

/** Oldest first: the order the page lists addresses and offers them in. */
const oldestFirst = <T extends SendingAddress>(addresses: T[]): T[] =>
  [...addresses].sort((x, y) => (x.createdAt ?? '').localeCompare(y.createdAt ?? ''))

/** "Feedback board and Changelog", "Support, Feedback board and Changelog". */
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

/**
 * What removing an address does to the email that sends from it, in one
 * sentence: the kinds that override to it fall back to the default, and when
 * it is the default, everything it sends falls to the platform address.
 * Support counts as using the address behind its inbox.
 */
function removalNote(
  id: string,
  senders: EmailSendersDTO,
  platformFrom: string | null,
  platformName: string
): string | null {
  if (senders.default?.mode === 'address' && senders.default.id === id) {
    return `It's your default address, so email will come from ${platformFrom ?? `the ${platformName.toLowerCase()}`} instead.`
  }
  const using = (
    Object.keys(SENDER_SURFACE_NAMES) as Array<keyof typeof SENDER_SURFACE_NAMES>
  ).filter((s) => {
    const choice = senders[s]
    return (
      (choice?.mode === 'address' && choice.id === id) ||
      (choice?.mode === 'inbox' && choice.fallbackId === id)
    )
  })
  if (using.length === 0) return null
  return `${listOf(using.map((s) => SENDER_SURFACE_NAMES[s]))} email will come from your default address instead.`
}

/** The meta line of a row whose domain is not live yet, or is live with its ownership record missing. */
function pendingMeta(
  domain: SendingDomainDTO,
  phase: DomainPhase,
  first: boolean,
  fallback: string
): string | null {
  if (phase === 'live') {
    const warning = first ? ownershipWarning(domain) : null
    return warning ? `The ownership record is missing. ${warning}` : null
  }
  if (!first) return `Waiting for ${domain.domain} to be verified`
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
  senders,
  workspaceName,
  platformFrom,
  platformName,
  available,
  guardPermitsAny,
  setsUpDomains,
  ownDomains: platformDomains,
  loaded,
}: {
  addresses: SendingAddress[]
  domains: SendingDomainDTO[]
  senders: EmailSendersDTO
  workspaceName: string
  platformFrom: string | null
  platformName: string
  available: boolean
  /** One workspace: email still leaves as the address, so nothing falls back. */
  guardPermitsAny: boolean
  /** Shared, and domains can be set up: a new domain brings records to add. */
  setsUpDomains: boolean
  /** The platform's own domains, which an address needs no setup to send from. */
  ownDomains: readonly string[]
  /** Whether the config has arrived, so an empty list really is empty. */
  loaded: boolean
}) {
  const [dialog, setDialog] = useState<SendingAddressDialogTarget | null>(null)
  const [domainRemoveTarget, setDomainRemoveTarget] = useState<{
    id: string
    domain: string
  } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{
    id: string
    address: string
    alsoDomain: string | null
    note: string | null
  } | null>(null)
  // Records of live domains the person opened from the row menu, by domain.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // One inline line for the last failed action, cleared when the next starts:
  // these failures name a fix, and a toast is gone before it is read.
  const [actionError, setActionError] = useState<string | null>(null)
  const del = useDeleteChannelAccount()
  const removeDomain = useDeleteSendingDomain()
  const restart = useRestartSendingDomainChecks()
  const sendTest = useSendTestEmail()
  const showError = (fallback: string) => (error: unknown) =>
    setActionError(errorText(error, fallback))
  const now = new Date()
  // What email does meanwhile: one workspace still sends as the address; a
  // shared server falls back to the default.
  const fallbackNote = guardPermitsAny
    ? ' Email is still sent from this address, but it may land in spam until this is fixed.'
    : " Email comes from your default address until it's fixed."

  // Listed oldest first: the panel and the domain's status line sit under the
  // address that has been on the domain longest, so adding another one does
  // not move them.
  const rows = oldestFirst(addresses).map((a) => {
    const domain = domainOf(a, domains)
    return { a, domain, phase: domain ? domainPhase(domain, now) : ('live' as const) }
  })
  const firstOnDomain = new Set<string>()
  const seen = new Set<string>()
  for (const { a, domain } of rows) {
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

  // Nothing added and nothing left over: the card says what email comes from
  // today and offers the one next step, in place of an empty list.
  const empty = loaded && rows.length === 0 && unused.length === 0

  return (
    <SettingsCard
      title="Sending addresses"
      flush
      // The empty state carries its own, as the one thing to do there.
      action={
        empty ? undefined : (
          <Button
            variant="outline"
            size="sm"
            disabled={!available}
            onClick={() => setDialog({ kind: 'add' })}
          >
            Add address
          </Button>
        )
      }
    >
      <SettingsList>
        {rows.map(({ a, domain, phase }) => {
          const first = firstOnDomain.has(a.id)
          // A live domain whose ownership record went missing still needs a record.
          const warned = !!domain && first && ownershipWarning(domain) !== null
          // Always open while the domain needs its records; opened from the menu once live.
          const open = domain ? phase !== 'live' || (expanded[domain.id] ?? warned) : false
          const address = a.address ?? ''
          const title = senderLabel(a, workspaceName)
          // Testable wherever real sends would use the address: a live domain,
          // or any address on a server whose guard permits every From.
          const testable = guardPermitsAny || (!!domain && phase === 'live')
          const items = [
            {
              label: 'Edit name',
              onSelect: () =>
                setDialog({ kind: 'rename', id: a.id, address, senderName: a.senderName ?? null }),
            },
            ...(domain && first && phase === 'live'
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
              onSelect: () =>
                setRemoveTarget({
                  id: a.id,
                  address: a.address ?? '',
                  // Removing the last address on a domain removes the domain too.
                  alsoDomain:
                    domain && rows.filter((r) => r.domain?.id === domain.id).length === 1
                      ? domain.domain
                      : null,
                  note: removalNote(a.id, senders, platformFrom, platformName),
                }),
            },
          ]
          return (
            <div key={a.id}>
              <SettingsListRow
                leading={<RowIcon icon={EnvelopeIcon} />}
                title={title}
                meta={(domain && pendingMeta(domain, phase, first, fallbackNote)) || undefined}
                wrapMeta={phase !== 'live' || warned}
                badges={<PhaseBadge phase={phase} />}
                trailing={
                  testable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sendTest.isPending}
                      onClick={() => {
                        setActionError(null)
                        sendTest.mutate(a.id, {
                          onSuccess: (r) => toast.success(`Test email sent to ${r.to}`),
                          onError: showError("Couldn't send the test email."),
                        })
                      }}
                    >
                      Send test
                    </Button>
                  ) : undefined
                }
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
      {empty ? (
        <EmptyState
          size="compact"
          icon={EnvelopeIcon}
          title="No sending addresses yet"
          description={
            !available
              ? "Custom sending addresses aren't available on this server."
              : platformFrom
                ? `Email comes from ${platformFrom}. Add an address to send from your own domain.`
                : 'Add an address to send email from your own domain.'
          }
          action={
            available ? (
              <Button variant="outline" onClick={() => setDialog({ kind: 'add' })}>
                Add address
              </Button>
            ) : undefined
          }
        />
      ) : !available || actionError ? (
        <div className="space-y-2 border-t border-border/50 px-4 py-3 sm:px-6">
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
      ) : null}
      <SendingAddressDialog
        target={dialog}
        workspaceName={workspaceName}
        domains={domains}
        setsUpDomains={setsUpDomains}
        ownDomains={platformDomains}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={removeTarget?.address ? `Remove ${removeTarget.address}?` : 'Remove address?'}
        description={[
          removeTarget?.note ?? 'Email can no longer be sent from this address.',
          removeTarget?.alsoDomain ? `${removeTarget.alsoDomain} will be removed too.` : null,
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Remove address"
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
