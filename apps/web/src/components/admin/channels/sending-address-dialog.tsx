/**
 * Add a sending address, or rename one: its email address (on add) and the
 * sender name its mail goes out under, which starts as the workspace name.
 *
 * An address is built on the workspace's Verified domains, as Add custom
 * domain builds a hostname: the local part is typed, the domain picked (tiles
 * for a few, a select for more) and shown fixed after the field. One Verified
 * domain is picked already.
 *
 * - Cloud (`verified-domains`): only a Verified domain. With none yet, Add
 *   domain goes to Settings > Domains, for a viewer who may add one.
 * - Self-hosted (`any`): Type an address reveals the free field, since the
 *   server's own mail setup is the limit there. With the domains unreadable,
 *   the free field is all there is, as before.
 * - `unavailable`: the free field, unchanged.
 *
 * As the address forms the dialog says what its sending domain means: one
 * already live sends at once, one not set up brings DNS records next. Under
 * the name it shows the sender line a recipient will see.
 */
import { useState, type ReactNode } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { VisibilityTiles } from '@/components/admin/settings/visibility-tiles'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import {
  MAX_DOMAIN_TILES,
  NoVerifiedDomains,
  SuffixField,
  useVerifiedDomains,
} from '@/components/admin/settings/verified-domain-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useCreateSendingAddress,
  useUpdateSendingAddressName,
} from '@/lib/client/mutations/channel-accounts'
import type {
  EmailChannelConfigDTO,
  SendingDomainDTO,
} from '@/lib/server/functions/channel-accounts'
import { errorText } from '@/lib/client/error-text'
import { addressDomainStanding } from './sending-domain-view'

/** What the dialog is open for: a new address (on a domain, when one is given), or renaming one. */
export type SendingAddressDialogTarget =
  | { kind: 'add'; domain?: string }
  | { kind: 'rename'; id: string; address: string; senderName: string | null }

/** The name as stored: the workspace name, or a blank one, is null. */
const storedName = (typed: string, workspaceName: string): string | null => {
  const name = typed.trim()
  return name && name !== workspaceName ? name : null
}

/**
 * The domains of the platform's own addresses (the workspace's inbox on it and
 * the address email leaves from by default), which need no setup to send from.
 */
export const ownDomains = (...addresses: Array<string | null | undefined>): string[] =>
  addresses.flatMap((a) => {
    const domain = /@([^\s<>@]+)>?\s*$/.exec(a ?? '')?.[1]?.toLowerCase()
    return domain ? [domain] : []
  })

/** Which addresses the server takes: see `SendingAddressMode`. */
type AddressMode = EmailChannelConfigDTO['addressMode']

/** What the dialog needs to read an address's domain as the server will. */
type DomainContext = {
  /** The workspace's sending domains, in whatever state. */
  domains?: SendingDomainDTO[]
  /**
   * `verified-domains`: shared, so an address has to be on a Verified domain
   * and waits for its sending records before it sends. `any`: one workspace,
   * any address. `unavailable`: no custom addresses. Absent reads as `any`.
   */
  addressMode?: AddressMode
  /** Domains that need no setup: the platform's own, which it already sends from. */
  ownDomains?: readonly string[]
  /** Reads the workspace's Verified domains; without it, or when it fails, they are unreadable. */
  loadVerifiedDomains?: () => Promise<readonly string[]>
  /** Goes to Settings > Domains with Add domain open; only for a viewer who may add one. */
  onAddDomain?: () => void
}

/** The choice that reveals the free field, where the server takes any address. */
const TYPED = 'typed'
const TYPE_AN_ADDRESS = 'Type an address'
const ASK_AN_ADMIN = 'Ask an admin to verify your domain.'
const ADDRESS_HEADING = 'sending-address-heading'

/** The local part as typed: anything from an @ on is the picked domain's to say. */
const localPart = (typed: string): string => typed.trim().split('@')[0] ?? ''

export function SendingAddressDialog({
  target,
  workspaceName,
  onClose,
  onAdded,
  finalFocus,
  ...context
}: {
  target: SendingAddressDialogTarget | null
  workspaceName: string
  onClose: () => void
  /** Called once an address is added, before the dialog closes. */
  onAdded?: () => void
  /**
   * Where focus goes when the dialog closes. Needed when a plain button opened
   * it: nothing else knows to send focus back there, and it lands on the page.
   */
  finalFocus?: () => HTMLElement | null | true
} & DomainContext) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" finalFocus={finalFocus}>
        {target ? (
          <SendingAddressForm
            key={target.kind === 'rename' ? target.id : 'add'}
            target={target}
            workspaceName={workspaceName}
            onClose={onClose}
            onAdded={onAdded}
            {...context}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** The line under the address: what its domain means for sending from it. */
function domainNote(
  standing: ReturnType<typeof addressDomainStanding>,
  setsUpDomains: boolean
): { text: string; verified?: boolean } | null {
  if (!standing) return null
  const { kind, domain } = standing
  if (kind === 'verified') {
    return { text: `${domain} is verified, so it can send right away.`, verified: true }
  }
  // Only a shared server holds an address back until its domain is verified.
  if (!setsUpDomains) return null
  if (kind === 'pending') {
    return { text: `${domain} is still being verified. This address can send once it is.` }
  }
  if (kind === 'attention') {
    return { text: `${domain} needs attention. This address can send once it's fixed.` }
  }
  return {
    text: `Next you'll add DNS records so email can send from ${domain}. Until they're found, it comes from your current address.`,
  }
}

function SendingAddressForm({
  target,
  workspaceName,
  onClose,
  onAdded,
  domains = [],
  addressMode = 'any',
  ownDomains = [],
  loadVerifiedDomains,
  onAddDomain,
}: {
  target: SendingAddressDialogTarget
  workspaceName: string
  onClose: () => void
  onAdded?: () => void
} & DomainContext) {
  const create = useCreateSendingAddress()
  const rename = useUpdateSendingAddressName()
  const adding = target.kind === 'add'
  const setsUpDomains = addressMode === 'verified-domains'
  // Cloud takes only a Verified domain; self-hosted offers them first.
  const picks = adding && addressMode !== 'unavailable'
  const verified = useVerifiedDomains(picks ? loadVerifiedDomains : undefined)
  const asked = target.kind === 'add' ? target.domain?.toLowerCase() : undefined
  // The choice made here; until one is, the domain asked for or the only one.
  const [picked, setPicked] = useState<string | null>(null)
  const [local, setLocal] = useState('')
  const [address, setAddress] = useState(asked ? `@${asked}` : '')
  const [senderName, setSenderName] = useState(
    target.kind === 'rename' ? (target.senderName ?? workspaceName) : workspaceName
  )
  // Inline rather than a toast: these failures name a fix (verify a domain
  // first, the plan's limit), and a toast is gone before it is read.
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || rename.isPending

  const offered = picks && Array.isArray(verified) ? verified : []
  const loading = picks && verified === undefined
  // The free field alone: where nothing is picked, or self-hosted with the
  // domains unreadable. Self-hosted also offers it as Type an address.
  const freeOnly = !picks || (verified === null && !setsUpDomains)
  const offersTyped = picks && !setsUpDomains
  const fallbackPick =
    (asked && offered.includes(asked) ? asked : null) ??
    (offered.length === 1 ? offered[0] : null) ??
    (asked && offersTyped && offered.length > 0 ? TYPED : null)
  const choice = picked ?? fallbackPick ?? ''
  const typing = freeOnly || choice === TYPED
  const chosenDomain = !typing && offered.includes(choice) ? choice : null
  // The empty state stands in for the field: there is nothing to add yet.
  const noneYet = picks && !loading && offered.length === 0 && !freeOnly && choice !== TYPED

  const typed = !adding
    ? target.address
    : typing
      ? address.trim()
      : chosenDomain && localPart(local)
        ? `${localPart(local)}@${chosenDomain}`
        : ''
  const found = adding ? addressDomainStanding(typed, domains) : null
  // The platform's own domain is neither new nor set up: nothing to say.
  const standing = found && !ownDomains.includes(found.domain) ? found : null
  const note = domainNote(standing, setsUpDomains)
  const bringsRecords = setsUpDomains && standing?.kind === 'new'
  const name = senderName.trim() || workspaceName
  // Shown once there is an address to show: the sender line as an inbox has it.
  const preview = !adding || !found ? null : name ? `${name} <${typed}>` : typed

  const submit = () => {
    setError(null)
    const name = storedName(senderName, workspaceName)
    if (target.kind === 'add') {
      create.mutate(
        { address: typed, senderName: name },
        {
          onSuccess: (added) => {
            // Refused as a value, worded by the server for this dialog: on
            // Cloud, a domain that is not Verified (any more). Not an error.
            if (!added.ok) {
              const { message: refusal } = added
              setError(refusal)
              return
            }
            // The one time adding an address changes what email sends from, so
            // it is said rather than left to be noticed.
            if (added.madeDefault) toast.success(`${added.address} is now your default address.`)
            onAdded?.()
            onClose()
          },
          onError: (e) => setError(errorText(e, "Couldn't add the address.")),
        }
      )
    } else {
      rename.mutate(
        { id: target.id, senderName: name },
        { onSuccess: onClose, onError: (e) => setError(errorText(e, "Couldn't save the name.")) }
      )
    }
  }

  const pick = (next: string) => {
    setPicked(next)
    setError(null)
  }
  const textLink = (label: string, onClick: () => void) => (
    <button type="button" className={`${INLINE_LINK} text-[13px]`} onClick={onClick}>
      {label}
    </button>
  )
  const freeField = (labelled: boolean) => (
    <Input
      id="sending-address"
      type="email"
      value={address}
      onChange={(e) => {
        setAddress(e.target.value)
        setError(null)
      }}
      placeholder="help@yourcompany.com"
      aria-label={labelled ? undefined : 'Email address'}
      aria-describedby={note ? 'sending-address-domain' : undefined}
      autoFocus
    />
  )
  const localField = (domain: string, autoFocus = false) => (
    <SuffixField
      id="sending-address-local"
      value={local}
      suffix={`@${domain}`}
      label="Email address"
      placeholder="help"
      disabled={pending}
      autoFocus={autoFocus}
      onChange={(value) => {
        setLocal(value)
        setError(null)
      }}
    />
  )

  let addressField: ReactNode = null
  if (!adding) {
    addressField = null
  } else if (loading) {
    addressField = <Skeleton className="h-9 w-full" aria-busy="true" />
  } else if (freeOnly) {
    addressField = freeField(true)
  } else if (offered.length === 0) {
    // No Verified domain yet: Add domain first. Self-hosted may type an address instead.
    addressField = (
      <div className="space-y-2">
        {choice === TYPED ? (
          freeField(true)
        ) : (
          <NoVerifiedDomains
            onAddDomain={
              onAddDomain && verified !== null
                ? () => {
                    onClose()
                    onAddDomain()
                  }
                : undefined
            }
            note={setsUpDomains ? ASK_AN_ADMIN : undefined}
          />
        )}
        {offersTyped && choice !== TYPED && textLink(TYPE_AN_ADDRESS, () => pick(TYPED))}
      </div>
    )
  } else if (offered.length === 1) {
    // One Verified domain: the field alone, the domain fixed after it.
    addressField =
      choice === TYPED ? (
        <div className="space-y-2">
          {freeField(false)}
          {textLink(`Use ${offered[0]}`, () => pick(offered[0]))}
        </div>
      ) : (
        <div className="space-y-2">
          {localField(offered[0], true)}
          {offersTyped && textLink(TYPE_AN_ADDRESS, () => pick(TYPED))}
        </div>
      )
  } else {
    const items = [
      ...offered.map((name) => ({ value: name, title: name })),
      ...(offersTyped ? [{ value: TYPED, title: TYPE_AN_ADDRESS }] : []),
    ]
    const fieldFor = (value: string) =>
      value !== choice ? null : (
        <div className="ps-10">{value === TYPED ? freeField(false) : localField(value, true)}</div>
      )
    addressField =
      items.length > MAX_DOMAIN_TILES ? (
        <div className="space-y-2">
          <Select value={choice || null} onValueChange={(next) => pick(String(next))}>
            <SelectTrigger aria-labelledby={ADDRESS_HEADING} className="w-full" disabled={pending}>
              <SelectValue placeholder="Choose a domain" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {choice === TYPED ? freeField(false) : chosenDomain ? localField(chosenDomain) : null}
        </div>
      ) : (
        <div data-slot="domain-choices">
          <VisibilityTiles
            name="sending-domain"
            value={choice}
            onChange={pick}
            options={items}
            disabled={pending}
            aria-labelledby={ADDRESS_HEADING}
            renderAfter={fieldFor}
          />
        </div>
      )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{adding ? 'Add address' : 'Edit name'}</DialogTitle>
        {!adding && (
          <DialogDescription>
            The name recipients see on email from {target.address}.
          </DialogDescription>
        )}
      </DialogHeader>
      <div className="space-y-3 py-4">
        {adding && (
          <div className="space-y-1.5">
            {freeOnly || (choice === TYPED && offered.length === 0) ? (
              <Label htmlFor="sending-address">Email address</Label>
            ) : (
              <p id={ADDRESS_HEADING} className="text-sm font-medium">
                Email address
              </p>
            )}
            {addressField}
            {note && (
              <p
                id="sending-address-domain"
                className="flex items-start gap-1.5 text-[13px] text-muted-foreground"
              >
                {note.verified && (
                  <CheckCircleIcon
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                )}
                {note.text}
              </p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sender-name">Sender name</Label>
          <Input
            id="sender-name"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder={workspaceName}
            maxLength={100}
            aria-describedby={preview ? 'sender-name-preview' : undefined}
          />
          {preview && (
            <p id="sender-name-preview" className="text-[13px] text-muted-foreground">
              Recipients see <span className="text-foreground">{preview}</span>
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {/* Nothing to add while the empty state asks for a domain first. */}
        {!noneYet && (
          <Button type="submit" disabled={pending || (adding && !typed)}>
            {!adding ? 'Save' : bringsRecords ? 'Add and show records' : 'Add address'}
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}
