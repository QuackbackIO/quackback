/**
 * Add a sending address, or rename one: its email address (on add) and the
 * sender name its mail goes out under, which starts as the workspace name.
 *
 * As the address is typed the dialog says what its domain means: one already
 * verified sends at once, a new one brings DNS records to add next. Under the
 * name it shows the sender line a recipient will see.
 */
import { useState } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { addressDomainStanding } from './sending-domain-view'

/** What the dialog is open for: a new address, or renaming one. */
export type SendingAddressDialogTarget =
  { kind: 'add' } | { kind: 'rename'; id: string; address: string; senderName: string | null }

/** The name as stored: the workspace name, or a blank one, is null. */
const storedName = (typed: string, workspaceName: string): string | null => {
  const name = typed.trim()
  return name && name !== workspaceName ? name : null
}

/** The server's sentence for a failed action, or the generic line. */
export const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

/** What the dialog needs to read an address's domain as the server will. */
type DomainContext = {
  /** The workspace's sending domains, in whatever state. */
  domains?: SendingDomainDTO[]
  /**
   * Whether an address on a domain not seen before brings DNS records to add,
   * and waits for them before it sends: true where the server is shared and
   * can set domains up.
   */
  setsUpDomains?: boolean
  /** Domains that need no setup: the platform's own, which it already sends from. */
  ownDomains?: readonly string[]
}

export function SendingAddressDialog({
  target,
  workspaceName,
  onClose,
  ...context
}: {
  target: SendingAddressDialogTarget | null
  workspaceName: string
  onClose: () => void
} & DomainContext) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target ? (
          <SendingAddressForm
            key={target.kind === 'rename' ? target.id : 'add'}
            target={target}
            workspaceName={workspaceName}
            onClose={onClose}
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
    text: `${domain} is new here. Next you'll add its DNS records, and email keeps coming from your current address until they're found.`,
  }
}

function SendingAddressForm({
  target,
  workspaceName,
  onClose,
  domains = [],
  setsUpDomains = false,
  ownDomains = [],
}: {
  target: SendingAddressDialogTarget
  workspaceName: string
  onClose: () => void
} & DomainContext) {
  const create = useCreateSendingAddress()
  const rename = useUpdateSendingAddressName()
  const [address, setAddress] = useState('')
  const [senderName, setSenderName] = useState(
    target.kind === 'rename' ? (target.senderName ?? workspaceName) : workspaceName
  )
  // Inline rather than a toast: these failures name a fix (verify a domain
  // first, the plan's limit), and a toast is gone before it is read.
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || rename.isPending
  const adding = target.kind === 'add'
  const typed = adding ? address.trim() : target.address
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
        { address: address.trim(), senderName: name },
        {
          onSuccess: (added) => {
            // The one time adding an address changes what email sends from, so
            // it is said rather than left to be noticed.
            if (added.madeDefault) toast.success(`${added.address} is now your default address.`)
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
            <Label htmlFor="sending-address">Email address</Label>
            <Input
              id="sending-address"
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="help@yourcompany.com"
              aria-describedby={note ? 'sending-address-domain' : undefined}
              autoFocus
            />
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
        <Button type="submit" disabled={pending || (adding && !address.trim())}>
          {!adding ? 'Save' : bringsRecords ? 'Add and show records' : 'Add address'}
        </Button>
      </DialogFooter>
    </form>
  )
}
